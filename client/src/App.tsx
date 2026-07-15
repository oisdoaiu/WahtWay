import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DEBUG } from "./debug";
import {
  getMessages, isStreaming, setMessages, appendMessage,
  appendToLast, setStreaming, subscribe,
} from "./conversations";
import "./App.css";

// ---- 类型 ----

interface SkillMeta {
  id: string;
  name: string;
  description: string;
  input: { type: string; properties?: Record<string, { type: string; description: string }>; required?: string[] };
  output: { type: string; properties?: Record<string, unknown> };
  requiredTools: string[];
  keywords?: string[];
}

// ---- 对话面板 ----

function ChatPanel({ conversationId, onTitleChange }: { showModal: boolean; conversationId: string; onTitleChange: (title: string) => void }) {
  const [, setTick] = useState(0);
  const messages = getMessages(conversationId);
  const streaming = isStreaming(conversationId);
  const [input, setInput] = useState("");
  const [skillName, setSkillName] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 订阅 store → 触发重渲染
  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);

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

  // 自动保存
  const saveTimeout = useRef<NodeJS.Timeout>();
  const messagesLen = messages.length;
  useEffect(() => {
    clearTimeout(saveTimeout.current);
    if (messagesLen === 0) return;
    saveTimeout.current = setTimeout(() => {
      fetch(`/api/conversations/${conversationId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: getMessages(conversationId) }),
      }).catch(() => {});
    }, 1000);
  }, [messagesLen, conversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const currentMessages = getMessages(conversationId);
    if (currentMessages.length === 0) onTitleChange(text.slice(0, 15) + (text.length > 15 ? "…" : ""));

    appendMessage(conversationId, { id: Date.now().toString(), role: "user", content: text });
    setInput("");
    setStreaming(conversationId, true);
    appendMessage(conversationId, { id: (Date.now() + 1).toString(), role: "assistant", content: "" });

    const history = currentMessages.map((m: any) => ({ role: m.role, content: m.content }));

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

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
            if (event.type === "skill_matched") setSkillName(event.data.skillName);
            else if (event.type === "tool_call") appendToLast(conversationId, `\n\n🔧 调用工具 \`${event.data.toolName}\`...`);
            else if (event.type === "tool_result") appendToLast(conversationId, " ✅");
            else if (event.type === "delta") appendToLast(conversationId, event.data);
            else if (event.type === "error") appendToLast(conversationId, `\n\n❌ ${event.data}`);
          } catch { /* skip */ }
        }
      }
    } catch (err: any) {
      appendToLast(conversationId, `❌ 连接失败: ${err.message}`);
    } finally {
      setStreaming(conversationId, false);
    }
  }, [input, streaming, conversationId, onTitleChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <div className="chat-panel">
      <header className="header">
        <h1>WahtWay</h1>
        <span className="subtitle">何以委</span>
        {skillName && <span className="skill-badge">已激活: {skillName}</span>}
      </header>
      <main className="chat-area">
        {messages.length === 0 && (
          <div className="welcome"><h2>🤔 Waht?</h2><p>问点什么吧，何以委帮你搞定。</p></div>
        )}
        {messages.map((msg: any) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="avatar">{msg.role === "user" ? "👤" : "🤖"}</div>
            <div className="bubble">
              {msg.skillName && <div className="skill-tag">🧠 {msg.skillName}</div>}
              {msg.role === "assistant" ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              ) : <p>{msg.content}</p>}
            </div>
          </div>
        ))}
        {streaming && messages[messages.length - 1]?.content === "" && (
          <div className="message assistant"><div className="avatar">🤖</div><div className="bubble thinking">正在思考...</div></div>
        )}
        <div ref={messagesEndRef} />
      </main>
      <footer className="input-area">
        <textarea id="chat-input" value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown} placeholder="输入你的问题…（Enter 发送，Shift+Enter 换行）"
          rows={2} disabled={streaming} />
        <button onClick={sendMessage} disabled={streaming || !input.trim()}>发送</button>
      </footer>
    </div>
  );
}

// ---- Skill 库面板 ----

function SkillsPanel({ onCreateSkill, skillsVersion }: { onCreateSkill: () => void; skillsVersion: number }) {
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSkills = () => {
    setLoading(true);
    fetch("/api/skills").then(r => r.json()).then(d => { setSkills(d.skills || []); setLoading(false); }).catch(() => { setSkills([]); setLoading(false); });
  };
  useEffect(() => { fetchSkills(); }, [skillsVersion]);

  const deleteSkill = async (id: string) => {
    await fetch(`/api/skills/${id}`, { method: "DELETE" });
    fetchSkills();
  };

  if (loading) return <div className="skills-loading">加载中...</div>;

  return (
    <div className="skills-panel">
      <header className="header"><h1>Skill 库</h1><span className="subtitle">{skills.length} 个可用技能</span><button className="create-btn" onClick={onCreateSkill}>+ 创建 Skill</button></header>
      <main className="skills-list">
        {skills.map(skill => (
          <div key={skill.id} className="skill-card">
            <div className="skill-card-header"><h3>🧠 {skill.name}</h3><code>{skill.id}</code><button className="skill-delete-btn" onClick={() => deleteSkill(skill.id)}>🗑️</button></div>
            <p className="skill-card-desc">{skill.description}</p>
            {skill.keywords && skill.keywords.length > 0 && (
              <div className="skill-card-keywords">{skill.keywords.map(kw => <span key={kw} className="kw-tag">{kw}</span>)}</div>
            )}
            <details className="skill-card-details">
              <summary>建议提供的信息</summary>
              {skill.input.properties ? (
                <ul>{Object.entries(skill.input.properties).map(([, val]) => <li key={val.description}>{val.description}</li>)}</ul>
              ) : <p className="no-params">无特定输入</p>}
            </details>
          </div>
        ))}
        {skills.length === 0 && <div className="welcome"><h2>📦</h2><p>还没有任何 Skill，点击右上角创建一个吧。</p></div>}
      </main>
    </div>
  );
}

// ---- 创建 Skill 弹窗 ----

function CreateSkillModal({ show, onClose, onSaved }: { show: boolean; onClose: () => void; onSaved: () => void }) {
  const [step, setStep] = useState<"describe" | "edit">("describe");
  const [skillDesc, setSkillDesc] = useState("");
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
      if (typeof skill.keywords === "string") skill.keywords = (skill.keywords as string).split(/[,，、\s]+/).filter(Boolean);
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
        <div className="modal-header"><h2>✨ 创建自定义 Skill</h2><button className="modal-close" onClick={handleClose}>×</button></div>
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
                <label>System Prompt</label><textarea rows={8} value={editSkill.systemPrompt || ""} onChange={e => setEditSkill({ ...editSkill, systemPrompt: e.target.value })} />
                <label>关键词（逗号分隔）</label><input value={Array.isArray(editSkill.keywords) ? (editSkill.keywords as string[]).join("、") : (editSkill.keywords as string) || ""} onChange={e => setEditSkill({ ...editSkill, keywords: e.target.value })} />
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
  const [skillsVersion, setSkillsVersion] = useState(0);
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
          <button className="nav-item" onClick={() => setShowModal(true)}><span className="nav-icon">✨</span><span>创建 Skill</span></button>
          <div className="sidebar-reset" onClick={async () => { if (!confirm("重置清空所有对话和自定义 Skill？")) return; await fetch("/api/reset", { method: "POST" }); window.location.reload(); }}>🔄 重置</div>
          <div className="sidebar-reset" onClick={() => { DEBUG.on = !DEBUG.on; setConvVersion(v => v + 1); }}>{DEBUG.on ? "🟢 调试中" : "⚫ 调试关"}</div>
        </div>
      </nav>
      <div className="main-content">
        {view === "chat" ? (
          conversationId ? <ChatPanel showModal={showModal} conversationId={conversationId} onTitleChange={handleTitleChange} /> : <div className="welcome"><h2>🤔 Waht?</h2></div>
        ) : (
          <SkillsPanel onCreateSkill={() => setShowModal(true)} skillsVersion={skillsVersion} />
        )}
      </div>
      <CreateSkillModal show={showModal} onClose={() => setShowModal(false)} onSaved={() => setSkillsVersion(v => v + 1)} />
    </div>
  );
}
