import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./App.css";

// ---- 类型 ----

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  skillName?: string;
}

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

function ChatPanel({ showModal }: { showModal: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [skillName, setSkillName] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);

    const assistantId = (Date.now() + 1).toString();
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
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
            if (event.type === "skill_matched") {
              setSkillName(event.data.skillName);
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, skillName: event.data.skillName } : m))
              );
            } else if (event.type === "tool_call") {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + `\n\n🔧 调用工具 \`${event.data.toolName}\`...` } : m))
              );
            } else if (event.type === "tool_result") {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + ` ✅` } : m))
              );
            } else if (event.type === "delta") {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + event.data } : m))
              );
            } else if (event.type === "error") {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + `\n\n❌ ${event.data}` } : m))
              );
            }
          } catch { /* skip */ }
        }
      }
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: `❌ 连接失败: ${err.message}` } : m))
      );
    } finally {
      setStreaming(false);
    }
  }, [input, streaming]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
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
          <div className="welcome">
            <h2>🤔 Waht?</h2>
            <p>问点什么吧，何以委帮你搞定。</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="avatar">{msg.role === "user" ? "👤" : "🤖"}</div>
            <div className="bubble">
              {msg.skillName && <div className="skill-tag">🧠 {msg.skillName}</div>}
              {msg.role === "assistant" ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              ) : (
                <p>{msg.content}</p>
              )}
            </div>
          </div>
        ))}
        {streaming && messages[messages.length - 1]?.content === "" && (
          <div className="message assistant">
            <div className="avatar">🤖</div>
            <div className="bubble thinking">正在思考...</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      <footer className="input-area">
        <textarea
          id="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入你的问题…（Enter 发送，Shift+Enter 换行）"
          rows={2}
          disabled={streaming}
        />
        <button onClick={sendMessage} disabled={streaming || !input.trim()}>发送</button>
      </footer>
    </div>
  );
}

// ---- Skill 库面板 ----

function SkillsPanel({ onCreateSkill, active, skillsVersion }: { onCreateSkill: () => void; active: boolean; skillsVersion: number }) {
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSkills = () => {
    setLoading(true);
    fetch("/api/skills")
      .then((res) => res.json())
      .then((data) => { setSkills(data.skills || []); setLoading(false); })
      .catch(() => { setSkills([]); setLoading(false); });
  };

  useEffect(() => { if (active) fetchSkills(); }, [active, skillsVersion]);

  const deleteSkill = async (id: string) => {
    await fetch(`/api/skills/${id}`, { method: "DELETE" });
    fetchSkills();
  };

  if (loading) return <div className="skills-loading">加载中...</div>;

  return (
    <div className="skills-panel">
      <header className="header">
        <h1>Skill 库</h1>
        <span className="subtitle">{skills.length} 个可用技能</span>
        <button className="create-btn" onClick={onCreateSkill}>+ 创建 Skill</button>
      </header>

      <main className="skills-list">
        {skills.map((skill) => (
          <div key={skill.id} className="skill-card">
            <div className="skill-card-header">
              <h3>🧠 {skill.name}</h3>
              <code>{skill.id}</code>
              <button className="skill-delete-btn" onClick={() => deleteSkill(skill.id)}>🗑️</button>
            </div>
            <p className="skill-card-desc">{skill.description}</p>

            {skill.keywords && skill.keywords.length > 0 && (
              <div className="skill-card-keywords">
                {skill.keywords.map((kw) => (
                  <span key={kw} className="kw-tag">{kw}</span>
                ))}
              </div>
            )}

            <details className="skill-card-details">
              <summary>建议提供的信息</summary>
              {skill.input.properties ? (
                <ul>
                  {Object.entries(skill.input.properties).map(([, val]) => (
                    <li key={val.description}>{val.description}</li>
                  ))}
                </ul>
              ) : (
                <p className="no-params">无特定输入</p>
              )}
            </details>
          </div>
        ))}

        {skills.length === 0 && (
          <div className="welcome">
            <h2>📦</h2>
            <p>还没有任何 Skill，点击右上角创建一个吧。</p>
          </div>
        )}
      </main>
    </div>
  );
}

// ---- 创建 Skill 弹窗 ----

function CreateSkillModal({
  show,
  onClose,
  onSaved,
}: {
  show: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
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
      const res = await fetch("/api/skills/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: skillDesc }),
      });
      const data = await res.json();
      if (data.skill) {
        setEditSkill(data.skill);
        setStep("edit");
      } else {
        setMsg("生成失败: " + (data.error || "未知错误"));
      }
    } catch (err: any) {
      setMsg("请求失败: " + err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!editSkill) return;
    try {
      const skill = { ...editSkill };
      if (typeof skill.keywords === "string") {
        skill.keywords = (skill.keywords as string).split(/[,，、\s]+/).filter(Boolean);
      }
      if (typeof skill.requiredTools === "string") skill.requiredTools = [];
      if (typeof skill.input === "string") skill.input = JSON.parse(skill.input as string);
      if (typeof skill.output === "string") skill.output = JSON.parse(skill.output as string);

      const res = await fetch("/api/skills/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(skill),
      });
      const data = await res.json();
      if (data.success) {
        onSaved();
        handleClose();
      } else {
        setMsg("保存失败: " + (data.error || "未知错误"));
      }
    } catch (err: any) {
      setMsg("保存失败: " + err.message);
    }
  };

  const handleClose = () => {
    setStep("describe");
    setSkillDesc("");
    setEditSkill(null);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>✨ 创建自定义 Skill</h2>
          <button className="modal-close" onClick={handleClose}>×</button>
        </div>

        {step === "describe" ? (
          <div className="modal-body">
            {msg && <p className="modal-msg">{msg}</p>}
            <p className="modal-hint">用自然语言描述你想要的技能，AI 会自动生成完整的 Skill 定义。</p>
            <textarea
              className="modal-textarea"
              value={skillDesc}
              onChange={(e) => setSkillDesc(e.target.value)}
              placeholder="比如：我想要一个帮我写周报的助手，按照本周完成、下周计划、遇到的问题、需要支持四个板块来输出"
              rows={5}
              disabled={generating}
            />
            <div className="modal-actions">
              <button onClick={handleClose}>取消</button>
              <button className="primary" onClick={handleGenerate} disabled={generating || !skillDesc.trim()}>
                {generating ? "生成中…" : "✨ 生成"}
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-body">
            {msg && <p className="modal-msg">{msg}</p>}
            <p className="modal-hint">以下是 AI 生成的 Skill 定义，你可以修改后保存。</p>
            {editSkill && (
              <div className="edit-form">
                <label>ID (英文标识)</label>
                <input value={editSkill.id || ""} onChange={(e) => setEditSkill({ ...editSkill, id: e.target.value })} />
                <label>名称</label>
                <input value={editSkill.name || ""} onChange={(e) => setEditSkill({ ...editSkill, name: e.target.value })} />
                <label>描述</label>
                <input value={editSkill.description || ""} onChange={(e) => setEditSkill({ ...editSkill, description: e.target.value })} />
                <label>System Prompt（核心：角色 + 输出格式）</label>
                <textarea rows={8} value={editSkill.systemPrompt || ""} onChange={(e) => setEditSkill({ ...editSkill, systemPrompt: e.target.value })} />
                <label>关键词（逗号分隔）</label>
                <input
                  value={
                    Array.isArray(editSkill.keywords)
                      ? (editSkill.keywords as string[]).join("、")
                      : (editSkill.keywords as string) || ""
                  }
                  onChange={(e) => setEditSkill({ ...editSkill, keywords: e.target.value })}
                />
              </div>
            )}
            <div className="modal-actions">
              <button onClick={handleClose}>取消</button>
              <button className="primary" onClick={handleSave}>保存</button>
            </div>
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

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar-brand">
          <h2>WahtWay</h2>
          <span>何以委</span>
        </div>
        <div className="sidebar-nav">
          <button className={`nav-item ${view === "chat" ? "active" : ""}`} onClick={() => setView("chat")}>
            <span className="nav-icon">💬</span>
            <span>对话</span>
          </button>
          <button className={`nav-item ${view === "skills" ? "active" : ""}`} onClick={() => setView("skills")}>
            <span className="nav-icon">🧠</span>
            <span>Skill 库</span>
          </button>
        </div>
        <div className="sidebar-footer">
          <button className="nav-item" onClick={() => setShowModal(true)}>
            <span className="nav-icon">✨</span>
            <span>创建 Skill</span>
          </button>
        </div>
      </nav>
      <div className="main-content">
        {view === "chat" ? <ChatPanel showModal={showModal} /> : <SkillsPanel onCreateSkill={() => setShowModal(true)} active={view === "skills"} skillsVersion={skillsVersion} />}
      </div>
      <CreateSkillModal show={showModal} onClose={() => setShowModal(false)} onSaved={() => setSkillsVersion(v => v + 1)} />
    </div>
  );
}
