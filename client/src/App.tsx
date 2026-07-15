import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DEBUG, addDebugEvent, getDebugEvents, onDebugEvents, clearDebugEvents } from "./debug";
import {
  getMessages, isStreaming, setMessages, appendMessage,
  appendToLast, setStreaming, subscribe,
} from "./conversations";
import "./App.css";

// ---- 全局 Toast（替代 alert，解决 Electron 焦点丢失） ----
let _showToast: (msg: string, type?: "info" | "error") => void = () => {};
export function toast(msg: string, type: "info" | "error" = "info") { _showToast(msg, type); }

function ToastContainer() {
  const [toast, setToast] = useState<{ msg: string; type: string; visible: boolean } | null>(null);
  _showToast = (msg, type = "info") => {
    setToast({ msg, type, visible: true });
    setTimeout(() => setToast(t => t ? { ...t, visible: false } : null), 2500);
    setTimeout(() => setToast(null), 3000);
  };
  if (!toast) return null;
  return (
    <div className={`toast ${toast.type} ${toast.visible ? "show" : ""}`}>
      {toast.msg}
    </div>
  );
}

// ---- 类型 ----

interface SkillMeta {
  id: string;
  name: string;
  description: string;
  systemPrompt?: string;
  whenToUse?: string;
  allowedTools?: string[];
  input: { type: string; properties?: Record<string, { type: string; description: string; enum?: string[] }>; required?: string[] };
  output: { type: string; properties?: Record<string, unknown> };
  requiredTools: string[];
  keywords?: string[];
}

// ---- 对话面板 ----

function ChatPanel({ conversationId, onTitleChange, onCreateSkill }: { showModal: boolean; conversationId: string; onTitleChange: (title: string) => void; onCreateSkill: (prefill?: string) => void }) {
  const [, setTick] = useState(0);
  const messages = getMessages(conversationId);
  const streaming = isStreaming(conversationId);
  const [input, setInput] = useState("");
  const [skillName, setSkillName] = useState<string | null>(null);
  const [thinkingStatus, setThinkingStatus] = useState("");
  const [toolCalls, setToolCalls] = useState<{name: string; startTime: number}[]>([]);
  const toolTimersRef = useRef<Map<string, number>>(new Map());
  const [model, setModel] = useState(() => localStorage.getItem("wahtway-model") || "deepseek-chat");
  const [skillId, setSkillId] = useState<string>("");
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [skillSearch, setSkillSearch] = useState("");
  const [allSkills, setAllSkills] = useState<SkillMeta[]>([]);
  const [permDialog, setPermDialog] = useState<{ reason: string; path: string } | null>(null);
  const [showPulse, setShowPulse] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [lastStats, setLastStats] = useState<{totalTokens: number; totalTime: number; rounds: number; toolCalls: number; model: string} | null>(null);
  const lastEventRef = useRef(Date.now());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 加载 Skill 列表（下拉用）
  const loadSkills = () => fetch("/api/skills").then(r => r.json()).then(d => setAllSkills(d.skills || []));
  useEffect(() => { loadSkills(); }, []);

  // 订阅 store → 触发重渲染
  useEffect(() => { const unsub = subscribe(() => setTick((t) => t + 1)); return () => { unsub(); }; }, []);

  // 切对话时加载（store 里没有则从 API 拉）
  useEffect(() => {
    if (getMessages(conversationId).length === 0 && !isStreaming(conversationId)) {
      fetch(`/api/conversations/${conversationId}`)
        .then((r) => r.json())
        .then((d) => setMessages(conversationId, d.messages || []))
        .catch(() => setMessages(conversationId, []));
    }
    setSkillName(null);
  }, [conversationId]);

  // 保存函数
  const saveNow = () => {
    const msgs = getMessages(conversationId);
    if (msgs.length === 0) return;
    fetch(`/api/conversations/${conversationId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: msgs }),
    }).catch(() => {});
  };

  // 流结束后立即保存
  useEffect(() => {
    if (!streaming && messages.length > 0) saveNow();
  }, [streaming]);

  // 定时兜底（编辑中）
  const saveTimeout = useRef<NodeJS.Timeout>(undefined);
  useEffect(() => {
    clearTimeout(saveTimeout.current);
    if (messages.length === 0 || streaming) return;
    saveTimeout.current = setTimeout(saveNow, 2000);
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 脉冲指示器：流进行中但暂无新内容到达时显示"思考中…"
  useEffect(() => {
    if (!streaming) { setShowPulse(false); return; }
    const timer = setInterval(() => {
      setShowPulse(Date.now() - lastEventRef.current > 500);
    }, 250);
    return () => clearInterval(timer);
  }, [streaming]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const currentMessages = getMessages(conversationId);
    if (currentMessages.length === 0) onTitleChange(text.slice(0, 15) + (text.length > 15 ? "…" : ""));

    // 合并附件路径到消息
    const fullText = attachedFiles.length > 0
      ? attachedFiles.map(f => `📎 ${f}`).join("\n") + (text ? "\n" + text : "")
      : text;
    appendMessage(conversationId, { id: Date.now().toString(), role: "user", content: fullText });
    setInput("");
    setAttachedFiles([]);
    setStreaming(conversationId, true);
    appendMessage(conversationId, { id: (Date.now() + 1).toString(), role: "assistant", content: "" });
    setToolCalls([]);
    setLastStats(null);

    const history = currentMessages.map((m: any) => ({ role: m.role, content: m.content }));

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000); // 2分钟超时

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history, model, skillId: skillId || undefined }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (!response.ok) {
        const msg = response.status === 504 ? "请求超时，请重试" : response.status >= 500 ? "服务器异常，稍后重试" : `请求失败 (${response.status})`;
        throw new Error(msg);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("无法读取流");

      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "skill_matched") { lastEventRef.current = Date.now(); setSkillName(event.data.skillName); setThinkingStatus(`已匹配「${event.data.skillName}」，正在分析…`); addDebugEvent("skill", event.data.skillName); }
            else if (event.type === "tool_call") { lastEventRef.current = Date.now(); const tn = event.data.toolName; toolTimersRef.current.set(tn, Date.now()); setThinkingStatus(`正在${toolLabel(tn)}…`); setToolCalls(prev => [...prev, {name: tn, startTime: Date.now()}]); addDebugEvent("tool_call", tn); }
            else if (event.type === "tool_result") {
              lastEventRef.current = Date.now();
              const tn = (event.data as any).toolName as string;
              const elapsed = toolTimersRef.current.has(tn) ? ((Date.now() - toolTimersRef.current.get(tn)!) / 1000).toFixed(1) + "s" : "";
              setToolCalls(prev => prev.map(t => t.name === tn ? {...t, name: tn} : t)); // keep for display
              setThinkingStatus(elapsed ? `${toolLabel(tn)} 完成 (${elapsed})` : "正在整理结果…");
              addDebugEvent("tool_result", "完成");
              // 检测权限拦截
              const res = (event.data as any)?.result;
              if (typeof res === "string" && res.startsWith("PERMISSION_REQUIRED::")) {
                const parts = res.split("::");
                setPermDialog({ reason: parts[1] || "未知", path: parts[2] || "" });
              }
            }
            else if (event.type === "delta") { lastEventRef.current = Date.now(); setThinkingStatus(""); appendToLast(conversationId, event.data); }
            else if (event.type === "stats") { lastEventRef.current = Date.now(); setLastStats(event.data as any); }
            else if (event.type === "error") { lastEventRef.current = Date.now(); setThinkingStatus(""); appendToLast(conversationId, `\n\n❌ ${event.data}`); addDebugEvent("error", event.data); }
            else if (event.type === "done") { lastEventRef.current = Date.now(); setThinkingStatus(""); if ((event.data as any)?.stats) setLastStats((event.data as any).stats); addDebugEvent("done", "流结束"); }
          } catch { /* skip */ }
        }
      }
    } catch (err: any) {
      const msg = err.name === "AbortError" ? "请求超时（2分钟），请简化问题重试"
        : err.message === "Failed to fetch" ? "网络连接失败，请检查网络后重试"
        : err.message || "未知错误";
      toast(msg, "error");
      appendToLast(conversationId, `\n\n❌ ${msg}`);
    } finally {
      setStreaming(conversationId, false);
    }
  }, [input, streaming, conversationId, onTitleChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // 文件选择器（Electron 原生对话框 / 浏览器隐藏 input）
  const openFilePicker = async () => {
    setShowFileMenu(false);
    const api = (window as any).electronAPI;
    if (api?.openFileDialog) {
      const paths = await api.openFileDialog();
      if (paths && paths.length > 0) setAttachedFiles(prev => [...prev, ...paths]);
    } else {
      const input = document.createElement("input");
      input.type = "file"; input.multiple = true;
      input.onchange = () => { if (input.files) setAttachedFiles(prev => [...prev, ...Array.from(input.files!).map(f => (f as any).path || f.name)]); };
      input.click();
    }
  };

  // 拖拽文件到输入区
  const [dragOver, setDragOver] = useState(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const paths: string[] = [];
    if (e.dataTransfer.files) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const f = e.dataTransfer.files[i];
        const api = (window as any).electronAPI;
        paths.push(api?.getFilePath ? api.getFilePath(f) : ((f as any).path || f.name));
      }
    }
    if (paths.length > 0) setAttachedFiles(prev => [...prev, ...paths]);
  };

  return (
    <div className="chat-panel">
      <header className="header">
        <h1>WahtWay</h1>
        <span className="subtitle">何以委</span>
        {skillName && <span className="skill-badge">已激活: {skillName}</span>}
        <select className="model-select" value={model} onChange={(e) => { const m = e.target.value; setModel(m); localStorage.setItem("wahtway-model", m); }}>
          <option value="deepseek-chat">DeepSeek V3 (快)</option>
          <option value="deepseek-v4-pro">DeepSeek V4 Pro (深)</option>
          <option value="deepseek-reasoner">DeepSeek R1 (推理)</option>
        </select>
      </header>
      <main className="chat-area">
        {messages.length === 0 && (
          <div className="welcome"><h2>🤔 Waht?</h2><p>问点什么吧，何以委帮你搞定。</p></div>
        )}
        {messages.map((msg: any, idx: number) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="avatar">{msg.role === "user" ? "👤" : "🤖"}</div>
            <div className="bubble">
              {msg.skillName && <div className="skill-tag">🧠 {msg.skillName}</div>}
              {msg.role === "assistant" ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              ) : <p>{msg.content}</p>}
              {streaming && idx === messages.length - 1 && msg.role === "assistant" && showPulse && msg.content && (
                <span className="stream-pulse">⟳ 思考中…</span>
              )}
              {lastStats && idx === messages.length - 1 && msg.role === "assistant" && (
                <div className="msg-stats">
                  {lastStats.totalTokens > 0 && <span>{lastStats.totalTokens} tokens</span>}
                  <span>{(lastStats.totalTime / 1000).toFixed(1)}s</span>
                  {lastStats.toolCalls > 0 && <span>{lastStats.toolCalls} 次工具调用</span>}
                </div>
              )}
            </div>
          </div>
        ))}
        {streaming && messages[messages.length - 1]?.content === "" && (
          <div className="message assistant">
            <div className="avatar">🤖</div>
            <div className="bubble thinking">
              <div>{thinkingStatus || "正在思考…"}<span className="thinking-dots"><span>.</span><span>.</span><span>.</span></span></div>
              {toolCalls.length > 0 && (
                <div className="tool-calls-summary">
                  {toolCalls.map((t, i) => {
                    const elapsed = Date.now() - t.startTime;
                    const elapsedStr = elapsed > 1000 ? ` ${(elapsed / 1000).toFixed(1)}s` : "";
                    return <span key={i} className="tool-call-badge">🔧 {toolLabel(t.name)}{elapsedStr}</span>;
                  })}
                </div>
              )}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>
      <footer className={`input-area${dragOver ? " drag-over" : ""}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}>
        {dragOver && <div className="drop-hint">📂 松开以填入文件路径</div>}
        <div className="input-toolbar">
          <div className="mode-selector" onClick={() => { setShowSkillPicker(!showSkillPicker); loadSkills(); }}>
            <span className="mode-badge">{skillId ? `🧠 ${allSkills.find(s => s.id === skillId)?.name || "Skill"}` : "🤖 智能模式"}</span>
            <span className="mode-arrow">{showSkillPicker ? "▴" : "▾"}</span>
          </div>
          {/* 文件上传按钮 */}
          <div className="file-add-wrapper">
            <button className="file-add-btn" onClick={() => setShowFileMenu(!showFileMenu)} title="添加文件">＋</button>
            {showFileMenu && (
              <div className="file-add-menu">
                <div className="file-add-menu-item" onClick={openFilePicker}>📂 从本地上传文件</div>
              </div>
            )}
          </div>
          {showSkillPicker && (
            <div className="skill-picker-dropdown">
              <input className="skill-search-input" placeholder="搜索 Skill…" value={skillSearch}
                onChange={(e) => setSkillSearch(e.target.value)} autoFocus />
              <div className="skill-picker-item" onClick={() => { setSkillId(""); setSkillName(null); setShowSkillPicker(false); setSkillSearch(""); }}>
                💬 普通对话（自动匹配）
              </div>
              {allSkills.filter(s => !skillSearch || [s.name, s.description, ...(s.keywords||[])].join(" ").toLowerCase().includes(skillSearch.toLowerCase()))
                .map(s => (
                  <div key={s.id} className={`skill-picker-item ${skillId === s.id ? "active" : ""}`}
                    onClick={() => { setSkillId(s.id); setSkillName(s.name); setShowSkillPicker(false); setSkillSearch(""); }}>
                    🧠 {s.name}
                    <span className="skill-picker-desc">{s.description}</span>
                  </div>
                ))}
              {skillSearch && allSkills.filter(s => [s.name, s.description, ...(s.keywords||[])].join(" ").toLowerCase().includes(skillSearch.toLowerCase())).length === 0 && (
                <div className="skill-picker-empty">没有匹配的技能，<span className="skill-picker-create" onClick={() => { setShowSkillPicker(false); onCreateSkill(skillSearch); }}>创建一个？</span></div>
              )}
            </div>
          )}
        </div>
        {attachedFiles.length > 0 && (
          <div className="attached-files">
            {attachedFiles.map((f, i) => (
              <span key={i} className="file-chip">
                📄 {f.split(/[\\/]/).pop()}
                <button className="file-chip-remove" onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
          </div>
        )}
        <div className="input-row">
          <textarea id="chat-input" value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown} placeholder="输入你的问题…（Enter 发送，Shift+Enter 换行）"
            rows={2} disabled={streaming} />
          <button onClick={sendMessage} disabled={streaming || (!input.trim() && attachedFiles.length === 0)}>发送</button>
        </div>
      </footer>

      {permDialog && (
        <div className="modal-overlay" onClick={() => setPermDialog(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>🔐 需要授权</h2></div>
            <div className="modal-body">
              <p>Agent 尝试操作受限路径：</p>
              <p className="perm-path">{permDialog.path || "未知路径"}</p>
              <p className="perm-reason">原因：{permDialog.reason}</p>
              <div className="modal-actions">
                <button onClick={() => setPermDialog(null)}>取消</button>
                <button className="primary" onClick={async () => {
                  await fetch("/api/tools/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: permDialog.path }) });
                  setPermDialog(null);
                  // 自动重试：重新发送同一条消息
                  setTimeout(() => sendMessage(), 300);
                }}>授权并重试</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Skill 库面板 ----

function SkillsPanel({ onCreateSkill, onEditSkill, skillsVersion }: { onCreateSkill: () => void; onEditSkill: (skill: SkillMeta) => void; skillsVersion: number }) {
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"local" | "hub">("local");

  // 本地 Skill
  const fetchSkills = () => {
    setLoading(true);
    fetch("/api/skills").then(r => r.json()).then(d => { setSkills(d.skills || []); setLoading(false); }).catch(() => { setSkills([]); setLoading(false); });
  };
  useEffect(() => { fetchSkills(); }, [skillsVersion]);

  const deleteSkill = async (id: string) => {
    await fetch(`/api/skills/${id}`, { method: "DELETE" });
    fetchSkills();
  };

  // 在线 Hub
  const [hubSkills, setHubSkills] = useState<any[]>([]);
  const [hubLoading, setHubLoading] = useState(false);
  const [hubError, setHubError] = useState("");
  const [hubSearch, setHubSearch] = useState("");
  const [hubSort, setHubSort] = useState("latest");
  const [downloading, setDownloading] = useState<Set<string>>(new Set());

  const fetchHub = (q?: string, sort?: string) => {
    setHubLoading(true);
    setHubError("");
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("sort", sort || hubSort);
    fetch(`/api/skills/hub/list?${params.toString()}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { setHubSkills(d.skills || []); setHubLoading(false); })
      .catch(err => { setHubError(err.message); setHubLoading(false); });
  };
  useEffect(() => { if (tab === "hub") fetchHub(); }, [tab, hubSort]);

  const downloadSkill = async (skillId: string) => {
    setDownloading(prev => new Set(prev).add(skillId));
    try {
      const res = await fetch("/api/skills/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "下载失败");
      fetchSkills(); // 刷新本地列表
      toast(`✅「${data.skill.name}」已安装！`);
    } catch (err: any) {
      toast(`下载失败: ${err.message}`, "error");
    } finally {
      setDownloading(prev => { const s = new Set(prev); s.delete(skillId); return s; });
    }
  };

  const localIds = new Set(skills.map(s => s.id));

  return (
    <div className="skills-panel">
      <header className="header">
        <h1>Skill 库</h1>
        <span className="subtitle">{tab === "local" ? `${skills.length} 个本地技能` : "在线 Skill Hub"}</span>
        {tab === "local" && <button className="create-btn" onClick={onCreateSkill}>+ 创建 Skill</button>}
      </header>

      <div className="skills-tabs">
        <button className={`skills-tab ${tab === "local" ? "active" : ""}`} onClick={() => setTab("local")}>📁 本地</button>
        <button className={`skills-tab ${tab === "hub" ? "active" : ""}`} onClick={() => setTab("hub")}>🌐 在线 Hub</button>
      </div>

      {tab === "local" && (
        <main className="skills-list">
          {loading && <div className="skills-loading">加载中...</div>}
          {!loading && skills.map(skill => (
            <div key={skill.id} className="skill-card">
              <div className="skill-card-header"><h3>🧠 {skill.name}</h3><code>{skill.id}</code><button className="skill-edit-btn" onClick={() => onEditSkill(skill)}>✏️</button><button className="skill-delete-btn" onClick={() => deleteSkill(skill.id)}>🗑️</button></div>
              <p className="skill-card-desc">{skill.description}</p>
              <details className="skill-card-details">
                <summary>建议提供的信息</summary>
                {skill.input.properties ? (
                  <ul>{Object.entries(skill.input.properties).map(([name, val]) => {
                    const hint = val.enum ? `（${val.enum.join(" / ")}）` : "";
                    return <li key={name}>{val.description}{hint}</li>;
                  })}</ul>
                ) : <p className="no-params">无特定输入</p>}
              </details>
            </div>
          ))}
          {!loading && skills.length === 0 && <div className="welcome"><h2>📦</h2><p>还没有任何 Skill，点击右上角创建一个吧。</p></div>}
        </main>
      )}

      {tab === "hub" && (
        <main className="skills-list">
          <div className="hub-toolbar">
            <input className="hub-search" type="search" placeholder="搜索在线 Skill…" value={hubSearch}
              onChange={e => setHubSearch(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") fetchHub(hubSearch, hubSort); }} />
            <select className="hub-sort" value={hubSort} onChange={e => { setHubSort(e.target.value); fetchHub(hubSearch, e.target.value); }}>
              <option value="latest">最新</option>
              <option value="downloads">下载量</option>
              <option value="rating">评分</option>
              <option value="name">名称</option>
            </select>
          </div>

          {hubError && <div className="hub-error">⚠️ {hubError}<button onClick={() => fetchHub(hubSearch, hubSort)}>重试</button></div>}
          {hubLoading && <div className="skills-loading">从 Hub 加载中...</div>}

          {!hubLoading && !hubError && hubSkills.map(skill => (
            <div key={skill.skillId} className={`skill-card hub-card ${localIds.has(skill.skillId) ? "installed" : ""}`}>
              <div className="skill-card-header">
                <h3>🧠 {skill.name}</h3>
                <code>{skill.skillId}</code>
                <span className="hub-meta">
                  {skill.authorName && <span className="hub-author">by {skill.authorName}</span>}
                  <span className="hub-downloads">⬇ {skill.downloadCount || 0}</span>
                  <span className="hub-rating">{skill.ratingCount ? `⭐ ${skill.ratingAverage}` : ""}</span>
                  <span className="hub-version">v{skill.version}</span>
                </span>
              </div>
              <p className="skill-card-desc">{skill.description}</p>
              <div className="hub-card-actions">
                {localIds.has(skill.skillId) ? (
                  <span className="hub-installed-badge">✅ 已安装</span>
                ) : (
                  <button className="hub-download-btn" disabled={downloading.has(skill.skillId)}
                    onClick={() => downloadSkill(skill.skillId)}>
                    {downloading.has(skill.skillId) ? "下载中…" : "⬇ 下载安装"}
                  </button>
                )}
              </div>
            </div>
          ))}
          {!hubLoading && !hubError && hubSkills.length === 0 && <div className="welcome"><h2>🌐</h2><p>Hub 上暂时没有匹配的 Skill</p></div>}
        </main>
      )}
    </div>
  );
}

// ---- 创建 Skill 弹窗 ----

function CreateSkillModal({ show, onClose, onSaved, prefill, skillToEdit }: { show: boolean; onClose: () => void; onSaved: () => void; prefill?: string; skillToEdit?: SkillMeta | null }) {
  const [step, setStep] = useState<"describe" | "edit">(skillToEdit ? "edit" : "describe");
  const [skillDesc, setSkillDesc] = useState("");

  useEffect(() => {
    if (show && skillToEdit) {
      setStep("edit");
      setEditSkill({...skillToEdit, whenToUse: skillToEdit.whenToUse || "", allowedTools: (skillToEdit.allowedTools || []).join(", ")});
    }
    if (show && prefill && !skillToEdit) setSkillDesc(prefill);
    if (!show) { setSkillDesc(""); setStep(skillToEdit ? "edit" : "describe"); }
  }, [show, prefill, skillToEdit]);
  const [generating, setGenerating] = useState(false);
  const [editSkill, setEditSkill] = useState<Record<string, any> | null>(null);
  const [msg, setMsg] = useState("");
  if (!show) return null;

  const handleGenerate = async () => {
    if (!skillDesc.trim() || generating) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/skills/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description: skillDesc }) });
      const data = await res.json();
      if (data.skill) { setEditSkill(data.skill); setStep("edit"); }
      else setMsg("生成失败: " + (data.error || "未知错误"));
    } catch (err: any) { setMsg("请求失败: " + err.message); }
    finally { setGenerating(false); }
  };

  const handleSave = async () => {
    if (!editSkill) return;
    try {
      const skill = { ...editSkill };
      if (typeof skill.requiredTools === "string") skill.requiredTools = [];
      if (typeof skill.input === "string") skill.input = JSON.parse(skill.input);
      if (typeof skill.output === "string") skill.output = JSON.parse(skill.output);
      const res = await fetch("/api/skills/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(skill) });
      const data = await res.json();
      if (data.success) { onSaved(); handleClose(); } else setMsg("保存失败: " + (data.error || "未知错误"));
    } catch (err: any) { setMsg("保存失败: " + err.message); }
  };

  const handleClose = () => { setStep("describe"); setSkillDesc(""); setEditSkill(null); setMsg(""); onClose(); };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h2>{skillToEdit ? "✏️ 编辑 Skill" : "✨ 创建自定义 Skill"}</h2><button className="modal-close" onClick={handleClose}>×</button></div>
        {step === "describe" ? (
          <div className="modal-body">
            {msg && <p className="modal-msg">{msg}</p>}
            <p className="modal-hint">用自然语言描述你想要的技能，AI 会自动生成完整的 Skill 定义。</p>
            <textarea className="modal-textarea" value={skillDesc} onChange={e => setSkillDesc(e.target.value)} placeholder="比如：我想要一个帮我写周报的助手..." rows={5} disabled={generating} />
            <div className="modal-actions"><button onClick={handleClose}>取消</button><button className="primary" onClick={handleGenerate} disabled={generating || !skillDesc.trim()}>{generating ? "生成中…" : "✨ 生成"}</button></div>
          </div>
        ) : (
          <div className="modal-body">
            {msg && <p className="modal-msg">{msg}</p>}
            <p className="modal-hint">以下是 AI 生成的 Skill 定义，你可以修改后保存。</p>
            {editSkill && (
              <div className="edit-form">
                <label>ID</label><input value={editSkill.id || ""} onChange={e => setEditSkill({ ...editSkill, id: e.target.value })} />
                <label>名称</label><input value={editSkill.name || ""} onChange={e => setEditSkill({ ...editSkill, name: e.target.value })} />
                <label>描述</label><input value={editSkill.description || ""} onChange={e => setEditSkill({ ...editSkill, description: e.target.value })} />
                <label>System Prompt</label><textarea rows={6} value={editSkill.systemPrompt || ""} onChange={e => setEditSkill({ ...editSkill, systemPrompt: e.target.value })} />
                <label>触发场景 (whenToUse)</label><textarea rows={2} placeholder="描述何时触发此 Skill，如：用户想制定学习计划时触发，不要在文件操作时触发" value={editSkill.whenToUse || ""} onChange={e => setEditSkill({ ...editSkill, whenToUse: e.target.value })} />
              </div>
            )}
            <div className="modal-actions"><button onClick={handleClose}>取消</button><button className="primary" onClick={handleSave}>保存</button></div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- App 主入口 ----

export default function App() {
  const [view, setView] = useState<"chat" | "skills">("chat");
  const [showModal, setShowModal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [skillsVersion, setSkillsVersion] = useState(0);
  const [prefillSkillDesc, setPrefillSkillDesc] = useState("");
  const [skillToEdit, setSkillToEdit] = useState<SkillMeta | null>(null);
  const [conversationId, setConversationId] = useState<string>("");
  const [conversations, setConversations] = useState<any[]>([]);
  const [convVersion, setConvVersion] = useState(0);

  const refreshConvs = async () => {
    const r = await fetch("/api/conversations");
    const d = await r.json();
    setConversations(d.conversations || []);
    return d.conversations || [];
  };

  useEffect(() => {
    (async () => {
      const list = await refreshConvs();
      if (list.length > 0) setConversationId(list[0].id);
      else {
        const r = await fetch("/api/conversations", { method: "POST" });
        const c = await r.json();
        setConversationId(c.id);
        setConversations([{ id: c.id, title: c.title, updatedAt: c.updatedAt }]);
      }
    })();
  }, []);

  useEffect(() => { refreshConvs(); }, [convVersion]);

  const newConversation = async () => {
    const r = await fetch("/api/conversations", { method: "POST" });
    const c = await r.json();
    setConversationId(c.id);
    setConvVersion(v => v + 1);
  };

  const deleteConversation = async (id: string) => {
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    const list = await refreshConvs();
    if (conversationId === id) {
      if (list.length > 0) setConversationId(list[0].id);
      else {
        const r = await fetch("/api/conversations", { method: "POST" });
        setConversationId((await r.json()).id);
      }
    }
    setConvVersion(v => v + 1);
  };

  const handleTitleChange = (title: string) => {
    fetch(`/api/conversations/${conversationId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) }).then(() => setConvVersion(v => v + 1));
  };

  return (
    <div className="app">
      <ToastContainer />
      <nav className="sidebar">
        <div className="sidebar-brand"><h2>WahtWay</h2><span>何以委</span></div>
        <div className="sidebar-nav">
          <button className={`nav-item ${view === "chat" ? "active" : ""}`} onClick={() => setView("chat")}><span className="nav-icon">💬</span><span>对话</span></button>
          <button className={`nav-item ${view === "skills" ? "active" : ""}`} onClick={() => setView("skills")}><span className="nav-icon">🧠</span><span>Skill 库</span></button>
        </div>
        {view === "chat" && (
          <div className="conv-list">
            <div className="conv-list-header"><span>历史对话</span><button className="conv-new-btn" onClick={newConversation}>＋</button></div>
            {conversations.map(c => (
              <div key={c.id} className={`conv-item ${c.id === conversationId ? "active" : ""}`} onClick={() => setConversationId(c.id)}>
                <span className="conv-title">{c.title}</span>
                <button className="conv-delete" onClick={e => { e.stopPropagation(); deleteConversation(c.id); }}>×</button>
              </div>
            ))}
          </div>
        )}
        <div className="sidebar-footer">
          <button id="sidebar-create-skill" className="nav-item" onClick={() => setShowModal(true)}><span className="nav-icon">✨</span><span>创建 Skill</span></button>
          <div className="sidebar-reset" onClick={() => setShowResetConfirm(true)}>🔄 重置</div>
          <div className="sidebar-reset" onClick={() => { DEBUG.on = !DEBUG.on; setConvVersion(v => v + 1); }}>{DEBUG.on ? "🟢 调试中" : "⚫ 调试关"}</div>
        </div>
      </nav>
      <div className="main-content">
        {view === "chat" ? (
          conversationId ? <ChatPanel showModal={showModal} conversationId={conversationId} onTitleChange={handleTitleChange} onCreateSkill={(prefill) => { setPrefillSkillDesc(prefill || ""); setShowModal(true); }} /> : <div className="welcome"><h2>🤔 Waht?</h2></div>
        ) : (
          <SkillsPanel onCreateSkill={() => setShowModal(true)} onEditSkill={(s) => { setSkillToEdit(s); setShowModal(true); }} skillsVersion={skillsVersion} />
        )}
      </div>
      <CreateSkillModal show={showModal} onClose={() => { setShowModal(false); setPrefillSkillDesc(""); setSkillToEdit(null); }} onSaved={() => { setSkillsVersion(v => v + 1); setSkillToEdit(null); }} prefill={prefillSkillDesc} skillToEdit={skillToEdit} />

      {showResetConfirm && (
        <div className="modal-overlay" onClick={() => setShowResetConfirm(false)}>
          <div className="modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>🔄 重置确认</h2></div>
            <div className="modal-body">
              <p>重置将清空所有对话记录和自定义 Skill（内置 Skill 保留），确认？</p>
              <div className="modal-actions">
                <button onClick={() => setShowResetConfirm(false)}>取消</button>
                <button className="primary" onClick={async () => {
                  await fetch("/api/reset", { method: "POST" });
                  window.location.reload();
                }}>确认重置</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    "list-files": "查看文件列表",
    "read-file": "读取文件",
    "search-files": "搜索文件",
    "file-info": "获取文件信息",
    "move-file": "移动文件",
    "copy-file": "复制文件",
    "new-folder": "创建文件夹",
    "write-file": "写入文件",
    "delete-file": "移入回收站",
  };
  return labels[name] || name;
}

function DebugPanel() {
  const [, setTick] = useState(0);
  useEffect(() => onDebugEvents(() => setTick((t) => t + 1)), []);
  const events = getDebugEvents();
  if (events.length === 0) return null;
  return (
    <div className="debug-panel">
      <div className="debug-panel-header">
        <span>📋 事件日志</span>
        <button onClick={clearDebugEvents}>清空</button>
      </div>
      {events.slice(0, 20).map((e, i) => (
        <div key={i} className="debug-event">
          <span className={"debug-badge " + e.type}>{e.type}</span>
          <span className="debug-data">{e.data}</span>
        </div>
      ))}
    </div>
  );
}
