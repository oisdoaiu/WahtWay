import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DEBUG, addDebugEvent, getDebugEvents, onDebugEvents, clearDebugEvents } from "./debug";
import {
  getMessages, isStreaming, setMessages, appendMessage,
  appendToLast, patchMessage, setStreaming, subscribe,
  getTodoItems, setTodoItems, updateLastMessage,
} from "./conversations";
import { McpPanel } from "./McpPanel";
import "./App.css";

const DEFAULT_MODEL = "deepseek-v4-flash";
const SUPPORTED_MODELS = new Set([DEFAULT_MODEL, "deepseek-v4-pro"]);

function getInitialModel(): string {
  const savedModel = localStorage.getItem("wahtway-model");
  return savedModel && SUPPORTED_MODELS.has(savedModel) ? savedModel : DEFAULT_MODEL;
}

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
  version?: number;
  origin?: "builtin" | "custom" | "hub" | "learned";
  learning?: {
    autoImprove: boolean;
    activeVersion: number;
    latestVersion: number;
    runCount: number;
    evidenceCount: number;
    lastObservedAt?: string;
    lastImprovedAt?: string;
    lastInsight?: string;
  };
}

interface ExternalToolConfig {
  id: string;
  name: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH";
  url: string;
  headers: Record<string, string>;
  parameters: Record<string, unknown>;
  query: Record<string, string>;
  body: unknown;
  responseDataPath: string;
  permission: "read" | "write";
  enabled: boolean;
  timeoutMs: number;
  maxResponseBytes: number;
  secretNames: string[];
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
  const [model, setModel] = useState(getInitialModel);
  const [skillId, setSkillId] = useState<string>("");
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [skillSearch, setSkillSearch] = useState("");
  const [allSkills, setAllSkills] = useState<SkillMeta[]>([]);
  const [permDialog, setPermDialog] = useState<{ reason: string; path: string; isCommand?: boolean; command?: string; cwd?: string; externalToken?: string; externalToolId?: string; mcpToken?: string; mcpServerId?: string; mcpToolName?: string } | null>(null);
  const [permBusy, setPermBusy] = useState(false);
  const [showPulse, setShowPulse] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [workspace, setWorkspace] = useState(() => localStorage.getItem("wahtway-workspace") || "");
    const abortRef = useRef<AbortController | null>(null);
  const msgHistory = useRef<string[]>([]);
  const historyIdx = useRef(-1);
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

    const currentMessages = [...getMessages(conversationId)];
    if (currentMessages.length === 0) onTitleChange(text.slice(0, 15) + (text.length > 15 ? "…" : ""));

    const history = currentMessages.map((m: any) => ({ role: m.role, content: m.content }));
    const userMessageId = Date.now().toString();
    const assistantMessageId = (Date.now() + 1).toString();

    // 合并附件路径到消息
    const fullText = attachedFiles.length > 0
      ? attachedFiles.map(f => `📎 ${f}`).join("\n") + (text ? "\n" + text : "")
      : text;
    appendMessage(conversationId, { id: userMessageId, role: "user", content: fullText });
    msgHistory.current.push(text);
    historyIdx.current = -1;
    setInput("");
    setAttachedFiles([]);
    setStreaming(conversationId, true);
    appendMessage(conversationId, { id: assistantMessageId, role: "assistant", content: "" });
    setToolCalls([]);
    setTodoItems(conversationId, []);

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history,
          model,
          skillId: skillId || undefined,
          workspace: workspace || undefined,
          conversationId,
          userMessageId,
          assistantMessageId,
        }),
        signal: controller.signal,
      });

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
            if (event.type === "skill_matched") {
              lastEventRef.current = Date.now();
              setSkillName(event.data.skillName);
              patchMessage(conversationId, assistantMessageId, {
                skillName: event.data.skillName,
                skillId: event.data.skillId,
                skillVersion: event.data.skillVersion,
                skillRunId: event.data.runId,
              });
              setThinkingStatus(`已匹配「${event.data.skillName}」，正在分析…`);
              addDebugEvent("skill", event.data.skillName);
            }
            else if (event.type === "tool_call") { lastEventRef.current = Date.now(); const tn = event.data.toolName; toolTimersRef.current.set(tn, Date.now()); setThinkingStatus(`正在${toolLabel(tn)}…`); setToolCalls(prev => [...prev, {name: tn, startTime: Date.now()}]); addDebugEvent("tool_call", tn); }
            else if (event.type === "tool_result") {
              lastEventRef.current = Date.now();
              const tn = (event.data as any).toolName as string;
              const res = (event.data as any)?.result;
              const elapsed = toolTimersRef.current.has(tn) ? ((Date.now() - toolTimersRef.current.get(tn)!) / 1000).toFixed(1) + "s" : "";
              setToolCalls(prev => prev.map(t => t.name === tn ? {...t, name: tn} : t)); // keep for display
              setThinkingStatus(elapsed ? `${toolLabel(tn)} 完成 (${elapsed})` : "正在整理结果…");
              addDebugEvent("tool_result", "完成");
              // 解析 todo-update 结果 → 可视化面板
              if (tn === "todo-update" && typeof res === "string") {
                const items = res.split(/\r?\n/).filter(function(l) { return l.startsWith("✅") || l.startsWith("⬜"); }).map(function(l, i) {
                  return { id: i, text: l.slice(2).trim(), done: l.startsWith("✅") };
                });
                if (items.length > 0) setTodoItems(conversationId, items);
              }
              if (typeof res === "string" && res.startsWith("MCP_PERMISSION_REQUIRED::")) {
                const parts = res.split("::");
                setPermDialog({ reason: "MCP Server 工具调用需要确认", path: `mcp-${parts[1] || "unknown"}-${parts[2] || "tool"}`, mcpServerId: parts[1], mcpToolName: parts[2], mcpToken: parts[3] });
              } else if (typeof res === "string" && res.startsWith("EXTERNAL_PERMISSION_REQUIRED::")) {
                const parts = res.split("::");
                setPermDialog({ reason: "外部工具将修改远端数据", path: `external-${parts[1] || "unknown"}`, externalToolId: parts[1], externalToken: parts[2] });
              } else if (typeof res === "string" && res.startsWith("PERMISSION_REQUIRED::")) {
                const parts = res.split("::");
                const reason = parts[1] || "未知";
                const path = parts[2] || "";
                // 检测是否是命令执行（含普通命令和危险命令）
                if (reason.includes("执行命令") || reason.includes("命令需确认") || reason.includes("命令含危险")) {
                  setPermDialog({ reason, path, isCommand: true, command: path, cwd: parts[3] || "" });
                } else {
                  setPermDialog({ reason, path });
                }
              }
            }
            else if (event.type === "delta") { lastEventRef.current = Date.now(); setThinkingStatus(""); appendToLast(conversationId, event.data); }
            else if (event.type === "stats") { lastEventRef.current = Date.now(); updateLastMessage(conversationId, msg => ({ ...msg, stats: event.data as any })); }
            else if (event.type === "error") { lastEventRef.current = Date.now(); setThinkingStatus(""); toast(String(event.data), "error"); appendToLast(conversationId, `\n\n❌ ${event.data}`); addDebugEvent("error", event.data); }
            else if (event.type === "done") { lastEventRef.current = Date.now(); setThinkingStatus(""); if ((event.data as any)?.stats) updateLastMessage(conversationId, msg => ({ ...msg, stats: (event.data as any).stats })); addDebugEvent("done", "流结束"); }
          } catch { /* skip */ }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        const msg = err.message === "Failed to fetch" ? "网络连接失败，请检查网络后重试"
          : err.message || "未知错误";
        toast(msg, "error");
        appendToLast(conversationId, `\n\n❌ ${msg}`);
      }
          } finally {
      abortRef.current = null;
      setStreaming(conversationId, false);
    }
  }, [input, streaming, conversationId, onTitleChange, attachedFiles, model, skillId, workspace]);

  const stopStreaming = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setStreaming(conversationId, false);
      setStreaming(conversationId, false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    else if (e.key === "ArrowUp") {
      const ta = e.currentTarget as HTMLTextAreaElement;
      if (ta.selectionStart === 0) {
        e.preventDefault();
        if (msgHistory.current.length > 0) {
          historyIdx.current = Math.min(historyIdx.current + 1, msgHistory.current.length - 1);
          setInput(msgHistory.current[msgHistory.current.length - 1 - historyIdx.current]);
          setTimeout(() => { ta.setSelectionRange(0, 0); }, 0);
        }
      }
    }
    else if (e.key === "ArrowDown") {
      const ta = e.currentTarget as HTMLTextAreaElement;
      if (ta.selectionStart === ta.value.length) {
        e.preventDefault();
        if (historyIdx.current > 0) {
          historyIdx.current--;
          setInput(msgHistory.current[msgHistory.current.length - 1 - historyIdx.current]);
          setTimeout(() => { ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
        } else {
          historyIdx.current = -1;
          setInput('');
        }
      }
    }
  };

  // ESC 中断当前请求 / 关闭弹窗
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (permDialog) { setPermDialog(null); return; }
      if (showFileMenu) { setShowFileMenu(false); return; }
      if (showSkillPicker) { setShowSkillPicker(false); return; }
      if (streaming && abortRef.current) {
        abortRef.current.abort();
        setStreaming(conversationId, false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [streaming, permDialog, showFileMenu, showSkillPicker, conversationId]);

  // 文件选择器（Electron 原生对话框 / 浏览器隐藏 input）
  const openFolderPicker = async () => {
    const api = (window as any).electronAPI;
    if (api?.openFolderDialog) {
      const dir = await api.openFolderDialog();
      if (dir) { setWorkspace(dir); localStorage.setItem("wahtway-workspace", dir); }
    }
  };

  const clearWorkspace = (event: React.MouseEvent) => {
    event.stopPropagation();
    setWorkspace("");
    localStorage.removeItem("wahtway-workspace");
    toast("已清空工作区");
  };

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
        <span className="workspace-control">
          <span className="workspace-badge" onClick={openFolderPicker} title="切换工作目录">{workspace ? `📂 ${workspace.split(/[\/]/).pop()}` : "📂 未设置工作区"}</span>
          {workspace && <button className="workspace-clear" onClick={clearWorkspace} title="清空工作区">×</button>}
        </span>
        <select className="model-select" value={model} onChange={(e) => { const m = e.target.value; setModel(m); localStorage.setItem("wahtway-model", m); }}>
          <option value="deepseek-v4-flash">DeepSeek V4 Flash (快)</option>
          <option value="deepseek-v4-pro">DeepSeek V4 Pro (深)</option>
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
              {msg.skillName && <div className="skill-tag">🧠 {msg.skillName}{msg.skillVersion ? ` · v${msg.skillVersion}` : ""}</div>}
              {msg.role === "assistant" ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              ) : <p>{msg.content}</p>}
              {streaming && idx === messages.length - 1 && msg.role === "assistant" && showPulse && msg.content && (
                <span className="stream-pulse">⟳ 思考中…</span>
              )}
              {msg.stats && msg.role === "assistant" && (
                <div className="msg-stats">
                  {msg.stats.totalTokens > 0 && <span>{msg.stats.totalTokens} tokens</span>}
                  <span>{(msg.stats.totalTime / 1000).toFixed(1)}s</span>
                  {msg.stats.toolCalls > 0 && <span>{msg.stats.toolCalls} 次工具调用</span>}
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
        {getTodoItems(conversationId).length > 0 && (
          <div className="todo-panel">
            <div className="todo-header">📋 任务进度 ({getTodoItems(conversationId).filter(function(t) { return t.done; }).length}/{getTodoItems(conversationId).length})</div>
            {getTodoItems(conversationId).map(function(t) { return (
              <div key={t.id} className={`todo-item ${t.done ? "done" : ""}`}>
                <span className="todo-check">{t.done ? "✅" : "⬜"}</span>
                <span className="todo-text">{t.text}</span>
              </div>
            ); })}
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
          {streaming && <button className="stop-btn" onClick={stopStreaming}>⏹</button>}
        </div>
      </footer>

      {permDialog && (
        <div className="modal-overlay" onClick={() => setPermDialog(null)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>🔐 确认操作</h2></div>
            <div className="modal-body">
              <p>{permDialog.mcpToken ? "即将调用 MCP 工具：" : permDialog.externalToken ? "即将调用写入型外部工具：" : permDialog.isCommand ? "即将执行命令：" : "即将操作路径："}</p>
              <p className="perm-path">{permDialog.isCommand && permDialog.command ? permDialog.command : (permDialog.path || "未知路径")}</p>
              {permDialog.cwd && <p className="perm-cwd">📂 {permDialog.cwd}</p>}
              <p className="perm-reason">原因：{permDialog.reason}</p>
              <div className="modal-actions">
                <button onClick={() => setPermDialog(null)} disabled={permBusy}>取消</button>
                <button className="primary" disabled={permBusy}
                  style={permDialog.reason.includes("危险") ? { background: "#c62828" } : {}}
                  onClick={async () => {
                  setPermBusy(true);
                  const isCmd = permDialog.isCommand;
                  const cmd = permDialog.command;
                  const cwd = permDialog.cwd;
                  const externalToken = permDialog.externalToken;
                  const mcpToken = permDialog.mcpToken;
                  setPermDialog(null); // 立即关闭弹窗
                  try {
                    if (mcpToken) {
                      const r = await fetch("/api/mcp/approve/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: mcpToken }) });
                      const d = await r.json();
                      if (!r.ok) throw new Error(d.error || "MCP 工具执行失败");
                      appendToLast(conversationId, `\n\n> MCP 工具结果\n\n\`\`\`\n${String(d.output || "").slice(0, 4000)}\n\`\`\``);
                    } else if (externalToken) {
                      const r = await fetch("/api/external-tools/approve/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: externalToken }) });
                      const d = await r.json();
                      if (!r.ok) throw new Error(d.error || "外部工具执行失败");
                      appendToLast(conversationId, `\n\n> 外部工具结果\n\n\`\`\`\n${String(d.output || "").slice(0, 4000)}\n\`\`\``);
                    } else if (isCmd) {
                      const r = await fetch("/api/tools/approve-command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: cmd, cwd }) });
                      const d = await r.json();
                      if (d.result) {
                        appendToLast(conversationId, `\n\n> Input\n\`\`\`sh\n${cmd}\n\`\`\`\n> Output\n\`\`\`\n${d.result.slice(0, 2000)}\n\`\`\``);
                      }
                    } else {
                      await fetch("/api/tools/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: permDialog.path }) });
                    }
                    if (!externalToken && !mcpToken) setTimeout(() => sendMessage(), 300);
                  } catch (e: any) { toast(e.message || "执行失败", "error"); }
                  finally { setPermBusy(false); }
                }}>{permBusy ? "执行中…" : "批准执行"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Skill 库面板 ----

function SkillsPanel({ onCreateSkill, onEditSkill, skillsVersion }: { onCreateSkill: () => void; onEditSkill: (skillId: string) => void; skillsVersion: number }) {
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"local" | "hub">("local");
  const [learningDetail, setLearningDetail] = useState<{ skill: SkillMeta; data: any } | null>(null);
  const [learningDetailLoading, setLearningDetailLoading] = useState(false);

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

  const setSkillAutoImprove = async (id: string, autoImprove: boolean) => {
    const response = await fetch(`/api/skills/${id}/learning`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoImprove }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      toast(data.error || "更新持续改进设置失败", "error");
      return;
    }
    fetchSkills();
  };

  const openLearningDetail = async (skill: SkillMeta) => {
    setLearningDetailLoading(true);
    try {
      const response = await fetch(`/api/skills/${skill.id}/learning`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "读取学习记录失败");
      setLearningDetail({ skill, data });
    } catch (error: any) {
      toast(error.message || "读取学习记录失败", "error");
    } finally {
      setLearningDetailLoading(false);
    }
  };

  const rollbackSkill = async (id: string, version = 1) => {
    const response = await fetch(`/api/skills/${id}/rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      toast(data.error || "回退失败", "error");
      return;
    }
    toast(version === 1 ? "已恢复原始 Skill" : `已切换到 Skill v${version}`);
    setLearningDetail(null);
    fetchSkills();
  };

  // 在线 Hub
  const [hubSkills, setHubSkills] = useState<any[]>([]);
  const [hubLoading, setHubLoading] = useState(false);
  const [hubError, setHubError] = useState("");
  const [hubSearch, setHubSearch] = useState("");
  const [hubSort, setHubSort] = useState("latest");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
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
              <div className="skill-card-header">
                <h3>🧠 {skill.name}</h3>
                <code>{skill.id}</code>
                <span className="skill-version-badge">v{skill.learning?.activeVersion || skill.version || 1}</span>
                <button className="skill-edit-btn" title="编辑 Skill" onClick={() => onEditSkill(skill.id)}>✏️</button>
                <button className="skill-delete-btn skill-delete-text" title="删除 Skill" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(skill.id); }}>×</button>
              </div>
              <p className="skill-card-desc">{skill.description}</p>
              {skill.learning && (
                <div className="skill-learning">
                  <div className="skill-learning-row">
                    <span>{skill.learning.runCount} 次观察</span>
                    <span>{skill.learning.evidenceCount} 条高置信差异</span>
                    <label className="skill-learning-toggle" title="允许 AI 从对话上下文中持续改进此 Skill">
                      <input
                        type="checkbox"
                        checked={skill.learning.autoImprove}
                        onChange={(event) => setSkillAutoImprove(skill.id, event.target.checked)}
                      />
                      <span>持续改进</span>
                    </label>
                    <button
                      className="skill-learning-detail-btn"
                      title="查看学习记录"
                      disabled={learningDetailLoading}
                      onClick={() => openLearningDetail(skill)}
                    >ⓘ</button>
                    {skill.learning.activeVersion > 1 && (
                      <button className="skill-rollback-btn" title="恢复原始版本" onClick={() => rollbackSkill(skill.id, 1)}>↶</button>
                    )}
                  </div>
                  {skill.learning.lastInsight && <p className="skill-learning-insight">{skill.learning.lastInsight}</p>}
                </div>
              )}
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

      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>确认删除</h2></div>
            <div className="modal-body">
              <p>确定要删除 Skill「{skills.find(s => s.id === deleteConfirm)?.name}」吗？此操作不可恢复。</p>
              <div className="modal-actions">
                <button onClick={() => setDeleteConfirm(null)}>取消</button>
                <button className="primary" style={{ background: "#c62828", color: "#fff" }} onClick={() => { deleteSkill(deleteConfirm); setDeleteConfirm(null); }}>确认删除</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {learningDetail && (
        <div className="modal-overlay" onClick={() => setLearningDetail(null)}>
          <div className="modal learning-detail-modal" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <h2>{learningDetail.skill.name} · 学习记录</h2>
              <button className="modal-close" title="关闭" onClick={() => setLearningDetail(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="learning-detail-summary">
                <span>{learningDetail.data.summary.runCount} 次观察</span>
                <span>{learningDetail.data.summary.evidenceCount} 条高置信差异</span>
                <span>当前 v{learningDetail.data.summary.activeVersion}</span>
              </div>

              <section className="learning-detail-section">
                <h3>归纳出的差异</h3>
                {learningDetail.data.evidence.filter((item: any) => item.learnable && item.confidence >= 0.75).length === 0 ? (
                  <p className="learning-detail-empty">暂未发现重复的高置信差异</p>
                ) : learningDetail.data.evidence
                  .filter((item: any) => item.learnable && item.confidence >= 0.75)
                  .slice(0, 8)
                  .map((item: any) => (
                    <div className="learning-evidence-row" key={item.id}>
                      <div><strong>{item.improvementHint || item.expected}</strong><span>{Math.round(item.confidence * 100)}% 置信度</span></div>
                      <p>{item.expected}</p>
                    </div>
                  ))}
              </section>

              <section className="learning-detail-section">
                <h3>版本历史</h3>
                <div className="learning-version-row">
                  <div><strong>v1</strong><span>原始版本</span></div>
                  {learningDetail.data.summary.activeVersion !== 1 && (
                    <button onClick={() => rollbackSkill(learningDetail.skill.id, 1)}>恢复</button>
                  )}
                </div>
                {learningDetail.data.versions.map((version: any) => (
                  <div className="learning-version-row" key={version.version}>
                    <div>
                      <strong>v{version.version}</strong>
                      <span>{version.status === "active" ? "使用中" : version.status === "rejected" ? "未通过" : "历史版本"}</span>
                      <p>{version.rationale}</p>
                      {version.evaluation && (
                        <small>评估 {Math.round(version.evaluation.baselineScore * 100)} → {Math.round(version.evaluation.candidateScore * 100)}</small>
                      )}
                    </div>
                    {version.evaluation?.approved && learningDetail.data.summary.activeVersion !== version.version && (
                      <button onClick={() => rollbackSkill(learningDetail.skill.id, version.version)}>恢复</button>
                    )}
                  </div>
                ))}
              </section>
            </div>
          </div>
        </div>
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
  const descLength = String(editSkill?.description || "").length;
  const systemPromptLength = String(editSkill?.systemPrompt || "").length;
  const whenToUseLength = String(editSkill?.whenToUse || "").length;

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
                <label>ID</label>
                <p className="field-hint">用于文件名和内部识别，建议使用小写英文、数字和短横线，例如 <code>weekly-report</code>。</p>
                <input value={editSkill.id || ""} onChange={e => setEditSkill({ ...editSkill, id: e.target.value })} />

                <label>名称</label>
                <p className="field-hint">展示给用户看的 Skill 名称，建议简短明确。</p>
                <input value={editSkill.name || ""} onChange={e => setEditSkill({ ...editSkill, name: e.target.value })} />

                <label className="field-label"><span>描述</span><span className={`field-count ${descLength > 50 ? "over" : ""}`}>{descLength}/50</span></label>
                <p className="field-hint">用于 Skill 卡片和匹配，建议 50 字以内，突出“能帮用户做什么”。</p>
                <input value={editSkill.description || ""} onChange={e => setEditSkill({ ...editSkill, description: e.target.value })} />

                <label className="field-label"><span>System Prompt</span><span className="field-count">{systemPromptLength} 字</span></label>
                <p className="field-hint">给模型看的核心指令，建议写清角色、输入要求、输出格式和边界。</p>
                <textarea rows={6} value={editSkill.systemPrompt || ""} onChange={e => setEditSkill({ ...editSkill, systemPrompt: e.target.value })} />

                <label className="field-label"><span>触发场景 (whenToUse)</span><span className={`field-count ${whenToUseLength > 120 ? "over" : ""}`}>{whenToUseLength}/120</span></label>
                <p className="field-hint">说明什么时候该用、什么时候不该用，可减少误触发。</p>
                <textarea rows={2} placeholder="例如：用户想制定学习计划时触发；不要在文件操作或闲聊时触发。" value={editSkill.whenToUse || ""} onChange={e => setEditSkill({ ...editSkill, whenToUse: e.target.value })} />
              </div>
            )}
            <div className="modal-actions"><button onClick={handleClose}>取消</button><button className="primary" onClick={handleSave}>保存</button></div>
          </div>
        )}
      </div>
    </div>
  );
}

const EMPTY_EXTERNAL_TOOL = {
  id: "",
  name: "",
  description: "",
  method: "GET" as const,
  url: "https://",
  headersText: "{}",
  parametersText: JSON.stringify({ type: "object", properties: {}, required: [] }, null, 2),
  queryText: "{}",
  bodyText: "null",
  responseDataPath: "",
  permission: "read" as const,
  enabled: true,
  timeoutMs: 10000,
  maxResponseBytes: 65536,
};

function ExternalToolsPanel() {
  const [tools, setTools] = useState<ExternalToolConfig[]>([]);
  const [editing, setEditing] = useState<typeof EMPTY_EXTERNAL_TOOL | null>(null);
  const [originalId, setOriginalId] = useState<string | null>(null);
  const [testArgs, setTestArgs] = useState("{}");
  const [testOutput, setTestOutput] = useState("");
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");

  const load = () => fetch("/api/external-tools").then(r => r.json()).then(d => setTools(d.tools || []));
  useEffect(() => { load().catch(() => setTools([])); }, []);

  const openEditor = (tool?: ExternalToolConfig) => {
    setOriginalId(tool?.id || null);
    setEditing(tool ? {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      method: tool.method,
      url: tool.url,
      headersText: JSON.stringify(tool.headers, null, 2),
      parametersText: JSON.stringify(tool.parameters, null, 2),
      queryText: JSON.stringify(tool.query, null, 2),
      bodyText: JSON.stringify(tool.body, null, 2),
      responseDataPath: tool.responseDataPath,
      permission: tool.permission,
      enabled: tool.enabled,
      timeoutMs: tool.timeoutMs,
      maxResponseBytes: tool.maxResponseBytes,
    } : { ...EMPTY_EXTERNAL_TOOL });
    setTestArgs("{}");
    setTestOutput("");
    setSecretName("");
    setSecretValue("");
  };

  const payload = () => {
    if (!editing) throw new Error("没有待保存的工具");
    return {
      id: editing.id,
      name: editing.name,
      description: editing.description,
      method: editing.method,
      url: editing.url,
      headers: JSON.parse(editing.headersText),
      parameters: JSON.parse(editing.parametersText),
      query: JSON.parse(editing.queryText),
      body: JSON.parse(editing.bodyText),
      responseDataPath: editing.responseDataPath,
      permission: editing.permission,
      enabled: editing.enabled,
      timeoutMs: editing.timeoutMs,
      maxResponseBytes: editing.maxResponseBytes,
    };
  };

  const save = async () => {
    try {
      const response = await fetch(originalId ? `/api/external-tools/${originalId}` : "/api/external-tools", {
        method: originalId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败");
      setEditing(null);
      await load();
      toast("外部工具已保存");
    } catch (error: any) { toast(error.message || "JSON 配置无效", "error"); }
  };

  const test = async () => {
    if (!originalId) { toast("请先保存工具，再测试连接", "error"); return; }
    try {
      setTestOutput("测试中...");
      const response = await fetch(`/api/external-tools/${originalId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: JSON.parse(testArgs) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "测试失败");
      setTestOutput(String(data.output || "(空响应)"));
    } catch (error: any) { setTestOutput(`错误: ${error.message}`); }
  };

  const addSecret = async () => {
    if (!originalId) { toast("请先保存工具", "error"); return; }
    const response = await fetch(`/api/external-tools/${originalId}/secrets/${encodeURIComponent(secretName.trim())}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: secretValue }),
    });
    const data = await response.json();
    if (!response.ok) { toast(data.error || "Secret 保存失败", "error"); return; }
    setSecretName(""); setSecretValue(""); await load(); toast("Secret 已保存");
  };

  return (
    <section className="external-tools-panel">
      <header className="header"><h1>外部工具</h1><span className="subtitle">受控 HTTPS API 连接器</span><button className="create-btn" onClick={() => openEditor()}>新建工具</button></header>
      <div className="external-tools-list">
        {tools.length === 0 && <div className="external-empty">还没有外部工具</div>}
        {tools.map(tool => (
          <div key={tool.id} className={`external-tool-row ${tool.enabled ? "" : "disabled"}`}>
            <div className="external-tool-state"><span className={`external-status ${tool.enabled ? "on" : ""}`} /></div>
            <div className="external-tool-info"><strong>{tool.name}</strong><code>external-{tool.id}</code><p>{tool.description}</p><small>{tool.method} · {new URL(tool.url).hostname} · {tool.permission === "read" ? "只读" : "写入需确认"}</small></div>
            <div className="external-tool-actions">
              <button onClick={() => openEditor(tool)}>编辑</button>
              <button onClick={async () => { await fetch(`/api/external-tools/${tool.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !tool.enabled }) }); await load(); }}>{tool.enabled ? "禁用" : "启用"}</button>
              <button className="danger" onClick={async () => { await fetch(`/api/external-tools/${tool.id}`, { method: "DELETE" }); await load(); }}>删除</button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal external-tool-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>{originalId ? "编辑外部工具" : "新建外部工具"}</h2><button className="modal-close" onClick={() => setEditing(null)}>×</button></div>
            <div className="external-form">
              <label>工具 ID<input value={editing.id} disabled={!!originalId} onChange={e => setEditing({ ...editing, id: e.target.value })} placeholder="weather-query" /></label>
              <label>名称<input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
              <label className="wide">描述<input value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} /></label>
              <label>方法<select value={editing.method} onChange={e => setEditing({ ...editing, method: e.target.value as any })}><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option></select></label>
              <label>权限<select value={editing.permission} onChange={e => setEditing({ ...editing, permission: e.target.value as any })}><option value="read">只读自动执行</option><option value="write">写入需要确认</option></select></label>
              <label className="wide">HTTPS URL<input value={editing.url} onChange={e => setEditing({ ...editing, url: e.target.value })} /></label>
              <label className="wide">参数 Schema<textarea rows={7} value={editing.parametersText} onChange={e => setEditing({ ...editing, parametersText: e.target.value })} /></label>
              <label>Query 模板<textarea rows={5} value={editing.queryText} onChange={e => setEditing({ ...editing, queryText: e.target.value })} /></label>
              <label>Headers<textarea rows={5} value={editing.headersText} onChange={e => setEditing({ ...editing, headersText: e.target.value })} /></label>
              <label className="wide">Body 模板<textarea rows={5} value={editing.bodyText} onChange={e => setEditing({ ...editing, bodyText: e.target.value })} /></label>
              <label>响应字段路径<input value={editing.responseDataPath} onChange={e => setEditing({ ...editing, responseDataPath: e.target.value })} placeholder="data.items" /></label>
              <label>超时（毫秒）<input type="number" value={editing.timeoutMs} onChange={e => setEditing({ ...editing, timeoutMs: Number(e.target.value) })} /></label>
              <label className="external-check"><input type="checkbox" checked={editing.enabled} onChange={e => setEditing({ ...editing, enabled: e.target.checked })} /> 启用</label>
              {originalId && <div className="external-secret-box wide"><strong>Secret</strong><div><input value={secretName} onChange={e => setSecretName(e.target.value.toUpperCase())} placeholder="API_KEY" /><input type="password" value={secretValue} onChange={e => setSecretValue(e.target.value)} placeholder="不会回显" /><button onClick={addSecret}>保存 Secret</button></div><small>在 Header、Query 或 Body 中使用 ${"${API_KEY}"}</small><div className="external-secret-list">{(tools.find(tool => tool.id === originalId)?.secretNames || []).map(name => <span key={name}>{name}<button title="删除 Secret" onClick={async () => { await fetch(`/api/external-tools/${originalId}/secrets/${name}`, { method: "DELETE" }); await load(); }}>×</button></span>)}</div></div>}
              {originalId && <div className="external-test-box wide"><strong>测试参数</strong><textarea rows={4} value={testArgs} onChange={e => setTestArgs(e.target.value)} /><button onClick={test}>测试连接</button>{testOutput && <pre>{testOutput}</pre>}</div>}
            </div>
            <div className="modal-actions"><button onClick={() => setEditing(null)}>取消</button><button className="primary" onClick={save}>保存工具</button></div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---- App 主入口 ----

export default function App() {
  const [view, setView] = useState<"chat" | "skills" | "external-tools" | "mcp">("chat");
  const [showModal, setShowModal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showCmdPalette, setShowCmdPalette] = useState(false);
  const [skillsVersion, setSkillsVersion] = useState(0);
  const [prefillSkillDesc, setPrefillSkillDesc] = useState("");
  const [appSkills, setAppSkills] = useState<SkillMeta[]>([]);
  const [editingConvId, setEditingConvId] = useState("");
  const [editTitle, setEditTitle] = useState("");

  // Load skills for command palette
  useEffect(() => { fetch("/api/skills").then(r => r.json()).then(d => setAppSkills(d.skills || [])); }, [showCmdPalette]);

  // Ctrl+K global handler
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); setShowCmdPalette(true); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [skillToEdit, setSkillToEdit] = useState<SkillMeta | null>(null);
  const [theme, setTheme] = useState(() => localStorage.getItem("wahtway-theme") || "light");
  const [conversationId, setConversationId] = useState<string>("");
  const [conversations, setConversations] = useState<any[]>([]);
  const [convVersion, setConvVersion] = useState(0);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const openEditSkill = async (skillId: string) => {
    try {
      const response = await fetch(`/api/skills/${skillId}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "读取 Skill 详情失败");
      setSkillToEdit(data.skill || null);
      setPrefillSkillDesc("");
      setShowModal(true);
    } catch (error: any) {
      toast(error.message || "读取 Skill 详情失败", "error");
    }
  };

  // 启动时检查 API Key 是否配置
  useEffect(() => {
    fetch("/api/health")
      .then(r => r.json())
      .then(d => setNeedsSetup(d.needsSetup || false))
      .catch(() => setNeedsSetup(false));
  }, []);

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
    fetch("/api/tools/clear-approvals", { method: "POST" }).catch(() => {});
  };

  const saveConvTitle = async (id: string, title: string) => {
    await fetch(`/api/conversations/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
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
    <div className={`app ${theme}`}>
      <ToastContainer />
      <nav className="sidebar">
        <div className="sidebar-brand"><h2>WahtWay</h2><span>何以委</span></div>
        <div className="sidebar-nav">
          <button className={`nav-item ${view === "chat" ? "active" : ""}`} onClick={() => setView("chat")}><span className="nav-icon">💬</span><span>对话</span></button>
          <button className={`nav-item ${view === "skills" ? "active" : ""}`} onClick={() => setView("skills")}><span className="nav-icon">🧠</span><span>Skill 库</span></button>
          <button className={`nav-item ${view === "external-tools" ? "active" : ""}`} onClick={() => setView("external-tools")}><span className="nav-icon">🔌</span><span>外部工具</span></button>
          <button className={`nav-item ${view === "mcp" ? "active" : ""}`} onClick={() => setView("mcp")}><span className="nav-icon">◫</span><span>MCP</span></button>
        </div>
        {view === "chat" && (
          <div className="conv-list">
            <div className="conv-list-header"><span>历史对话</span><button className="conv-new-btn" onClick={newConversation}>＋</button></div>
            {conversations.map(c => (
              <div key={c.id} className={`conv-item ${c.id === conversationId ? "active" : ""}`} onClick={() => setConversationId(c.id)}>
                {editingConvId === c.id ? (
                <input className="conv-title-input" value={editTitle} onChange={e => setEditTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { const t = editTitle.trim() || c.title; saveConvTitle(c.id, t); setEditingConvId(""); setConvVersion(v => v + 1); } if (e.key === "Escape") setEditingConvId(""); }}
                  onBlur={() => { const t = editTitle.trim() || c.title; saveConvTitle(c.id, t); setEditingConvId(""); setConvVersion(v => v + 1); }}
                  onClick={e => e.stopPropagation()} autoFocus />
              ) : (
                <span className="conv-title" onDoubleClick={() => { setEditingConvId(c.id); setEditTitle(c.title); }}>
                  <span className="conv-title-text">{c.title.length > 12 ? c.title.slice(0, 12) + "…" : c.title}</span>
                  <button className="conv-edit-btn" onClick={e => { e.stopPropagation(); setEditingConvId(c.id); setEditTitle(c.title); }}>✎</button>
                </span>
              )}
                <button className="conv-delete" onClick={e => { e.stopPropagation(); deleteConversation(c.id); }}>×</button>
              </div>
            ))}
          </div>
        )}
        <div className="sidebar-footer">
          <button id="sidebar-create-skill" className="nav-item" onClick={() => setShowModal(true)}><span className="nav-icon">✨</span><span>创建 Skill</span></button>
          <div className="sidebar-reset" onClick={() => setShowResetConfirm(true)}>🔄 重置</div>
          <BalanceWidget />
          <div className="sidebar-item" onClick={() => { const t = theme === "light" ? "dark" : "light"; setTheme(t); localStorage.setItem("wahtway-theme", t); }}>{theme === "light" ? "🌙 深色模式" : "☀️ 浅色模式"}</div>
        <div className="sidebar-reset" onClick={() => { DEBUG.on = !DEBUG.on; setConvVersion(v => v + 1); }}>{DEBUG.on ? "🟢 调试中" : "⚫ 调试关"}</div>
        <div className="sidebar-reset" onClick={() => setShowCmdPalette(true)}>⌨ 命令面板 (Ctrl+K)</div>
        </div>
      </nav>
      <div className="main-content">
        {view === "chat" ? (
          conversationId ? <ChatPanel showModal={showModal} conversationId={conversationId} onTitleChange={handleTitleChange} onCreateSkill={(prefill) => { setPrefillSkillDesc(prefill || ""); setShowModal(true); }} /> : <div className="welcome"><h2>🤔 Waht?</h2></div>
        ) : view === "skills" ? (
          <SkillsPanel onCreateSkill={() => setShowModal(true)} onEditSkill={openEditSkill} skillsVersion={skillsVersion} />
        ) : view === "external-tools" ? (
          <ExternalToolsPanel />
        ) : (
          <McpPanel onNotify={(message, type = "info") => toast(message, type)} />
        )}
      </div>
      <CommandPalette show={showCmdPalette} onClose={() => setShowCmdPalette(false)} skills={appSkills}
        onSelectSkill={() => { setView("chat"); }}
        onCreateSkill={() => setShowModal(true)}
        onGoHub={() => setView("skills")}
        onToggleTheme={() => { const t = theme === "light" ? "dark" : "light"; setTheme(t); localStorage.setItem("wahtway-theme", t); }}
        theme={theme} />
      <CreateSkillModal show={showModal} onClose={() => { setShowModal(false); setPrefillSkillDesc(""); setSkillToEdit(null); }} onSaved={() => { setSkillsVersion(v => v + 1); setSkillToEdit(null); }} prefill={prefillSkillDesc} skillToEdit={skillToEdit} />

      <SetupScreen show={needsSetup === true} onDone={() => setNeedsSetup(false)} />

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

function formatBalance(data: any): string {
  const balances = Array.isArray(data?.balance_infos) ? data.balance_infos : [];
  if (balances.length === 0) return "未返回余额";

  return balances.map((item: any) => {
    const currency = item.currency || "余额";
    const total = item.total_balance ?? item.topped_up_balance ?? item.granted_balance ?? "--";
    return `${currency} ${total}`;
  }).join(" · ");
}

function BalanceWidget() {
  const [balance, setBalance] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const queryBalance = async () => {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/balance");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "余额查询失败");
      setBalance(formatBalance(data));
    } catch (err: any) {
      const message = err.message || "余额查询失败";
      setError(message);
      toast(message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="balance-widget">
      <button className="balance-button" onClick={queryBalance} disabled={loading} title="手动查询 DeepSeek 账户余额">
        <span>💰</span><span>{loading ? "查询中…" : "查询余额"}</span>
      </button>
      {balance && <div className="balance-value">{balance}</div>}
      {!balance && error && <div className="balance-error">查询失败</div>}
    </div>
  );
}

function SetupScreen({ show, onDone }: { show: boolean; onDone: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (!show) return null;

  const submit = async () => {
    if (!key.trim() || busy) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: key.trim() }) });
      const d = await r.json();
      if (d.success) onDone();
      else setErr(d.error || "保存失败");
    } catch { setErr("网络错误，请检查后端是否启动"); }
    finally { setBusy(false); }
  };

  return (
    <div className="setup-overlay">
      <div className="setup-card">
        <h1>🚀 欢迎使用 WahtWay</h1>
        <p>需要配置 DeepSeek API Key 才能使用。</p>
        <p className="setup-hint">
          前往 <a href="https://platform.deepseek.com/api_keys" target="_blank">platform.deepseek.com</a> 注册获取 API Key。
        </p>
        <input className="setup-input" type="password" placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx" value={key}
          onChange={e => setKey(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submit(); }} autoFocus />
        {err && <p className="setup-error">{err}</p>}
        <button className="setup-btn" onClick={submit} disabled={busy || !key.trim()}>
          {busy ? "验证中…" : "开始使用"}
        </button>
      </div>
    </div>
  );
}

function CommandPalette({ show, onClose, skills, onSelectSkill, onCreateSkill, onGoHub, onToggleTheme, theme }: { show: boolean; onClose: () => void; skills: SkillMeta[]; onSelectSkill: () => void; onCreateSkill: () => void; onGoHub: () => void; onToggleTheme: () => void; theme: string }) {
  const [q, setQ] = useState("");
  if (!show) return null;
  const cmds: { id: string; label: string; icon: string; action: () => void }[] = [
    { id: "chat", label: "💬 切换到对话", icon: "💬", action: () => { onSelectSkill(); onClose(); } },
    { id: "create", label: "✨ 创建新 Skill", icon: "✨", action: () => { onCreateSkill(); onClose(); } },
    { id: "hub", label: "🌐 Skill Hub", icon: "🌐", action: () => { onGoHub(); onClose(); } },
    { id: "theme", label: theme === "light" ? "🌙 切换深色模式" : "☀️ 切换浅色模式", icon: theme === "light" ? "🌙" : "☀️", action: () => { onToggleTheme(); onClose(); } },
  ];
  const filtered = cmds.filter(c => !q || c.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()}>
        <input className="cmd-input" placeholder="输入命令…" value={q} onChange={e => setQ(e.target.value)} autoFocus onKeyDown={e => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && filtered.length > 0) { filtered[0].action(); }
        }} />
        <div className="cmd-list">
          {filtered.map(c => (
            <div key={c.id} className="cmd-item" onClick={c.action}>
              <span>{c.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
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
