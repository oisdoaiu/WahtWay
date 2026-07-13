import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./App.css";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  skillName?: string;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [skillName, setSkillName] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // --- 创建 Skill 弹窗 ---
  const [showModal, setShowModal] = useState(false);
  const [modalStep, setModalStep] = useState<"describe" | "edit">("describe");
  const [skillDesc, setSkillDesc] = useState("");
  const [generating, setGenerating] = useState(false);
  const [editSkill, setEditSkill] = useState<Record<string, string> | null>(null);

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
        setModalStep("edit");
      } else {
        alert("生成失败: " + (data.error || "未知错误"));
      }
    } catch (err: any) {
      alert("请求失败: " + err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!editSkill) return;
    try {
      // 处理 keywords：可能是逗号分隔的字符串或数组
      const skill = { ...editSkill };
      if (typeof skill.keywords === "string") {
        skill.keywords = (skill.keywords as string).split(/[,，、\s]+/).filter(Boolean);
      }
      if (typeof skill.requiredTools === "string") {
        skill.requiredTools = [];
      }
      // 确保 input/output 是对象
      if (typeof skill.input === "string") {
        skill.input = JSON.parse(skill.input as string);
      }
      if (typeof skill.output === "string") {
        skill.output = JSON.parse(skill.output as string);
      }

      const res = await fetch("/api/skills/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(skill),
      });
      const data = await res.json();
      if (data.success) {
        alert(`Skill「${skill.name}」创建成功！`);
        setShowModal(false);
        setSkillDesc("");
        setEditSkill(null);
        setModalStep("describe");
      } else {
        alert("保存失败: " + (data.error || "未知错误"));
      }
    } catch (err: any) {
      alert("保存失败: " + err.message);
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setSkillDesc("");
    setEditSkill(null);
    setModalStep("describe");
  };

  // 自动滚到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    // 添加用户消息
    const userMsg: Message = { id: Date.now().toString(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);

    // 创建一条空的 assistant 消息，后续逐字填充
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

        // 解析 SSE 行
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // 最后一行可能不完整，留到下次

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6);
          try {
            const event = JSON.parse(jsonStr);

            if (event.type === "skill_matched") {
              setSkillName(event.data.skillName);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, skillName: event.data.skillName } : m
                )
              );
            } else if (event.type === "delta") {
              // 逐字追加
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: m.content + event.data } : m
                )
              );
            } else if (event.type === "done") {
              // 流结束，done 事件含完整内容，不需要再处理
            } else if (event.type === "error") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + `\n\n❌ 出错了: ${event.data}` }
                    : m
                )
              );
            }
          } catch {
            // 非 JSON 行跳过
          }
        }
      }
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: `❌ 连接失败: ${err.message}` }
            : m
        )
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
    <div className="app">
      <header className="header">
        <h1>WahtWay</h1>
        <span className="subtitle">何以委</span>
        {skillName && <span className="skill-badge">已激活: {skillName}</span>}
        <button className="create-btn" onClick={() => setShowModal(true)}>
          + 创建 Skill
        </button>
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
              {msg.skillName && (
                <div className="skill-tag">🧠 {msg.skillName}</div>
              )}
              {msg.role === "assistant" ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              ) : (
                <p>{msg.content}</p>
              )}
            </div>
          </div>
        ))}

        {streaming && messages[messages.length -1]?.content === "" && (
          <div className="message assistant">
            <div className="avatar">🤖</div>
            <div className="bubble thinking">正在思考...</div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      <footer className="input-area">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入你的问题…（Enter 发送，Shift+Enter 换行）"
          rows={2}
          disabled={streaming}
        />
        <button onClick={sendMessage} disabled={streaming || !input.trim()}>
          发送
        </button>
      </footer>

      {/* 创建 Skill 弹窗 */}
      {showModal && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>✨ 创建自定义 Skill</h2>
              <button className="modal-close" onClick={handleCloseModal}>×</button>
            </div>

            {modalStep === "describe" ? (
              <div className="modal-body">
                <p className="modal-hint">
                  用自然语言描述你想要的技能，AI 会自动生成完整的 Skill 定义。
                </p>
                <textarea
                  className="modal-textarea"
                  value={skillDesc}
                  onChange={(e) => setSkillDesc(e.target.value)}
                  placeholder="比如：我想要一个帮我写周报的助手，按照本周完成、下周计划、遇到的问题、需要支持四个板块来输出"
                  rows={5}
                  disabled={generating}
                />
                <div className="modal-actions">
                  <button onClick={handleCloseModal}>取消</button>
                  <button
                    className="primary"
                    onClick={handleGenerate}
                    disabled={generating || !skillDesc.trim()}
                  >
                    {generating ? "生成中…" : "✨ 生成"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="modal-body">
                <p className="modal-hint">
                  以下是 AI 生成的 Skill 定义，你可以修改后保存。
                </p>
                {editSkill && (
                  <div className="edit-form">
                    <label>ID (英文标识)</label>
                    <input
                      value={editSkill.id || ""}
                      onChange={(e) => setEditSkill({ ...editSkill, id: e.target.value })}
                    />
                    <label>名称</label>
                    <input
                      value={editSkill.name || ""}
                      onChange={(e) => setEditSkill({ ...editSkill, name: e.target.value })}
                    />
                    <label>描述</label>
                    <input
                      value={editSkill.description || ""}
                      onChange={(e) => setEditSkill({ ...editSkill, description: e.target.value })}
                    />
                    <label>System Prompt（核心：角色 + 输出格式）</label>
                    <textarea
                      rows={8}
                      value={editSkill.systemPrompt || ""}
                      onChange={(e) => setEditSkill({ ...editSkill, systemPrompt: e.target.value })}
                    />
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
                  <button onClick={handleCloseModal}>取消</button>
                  <button className="primary" onClick={handleSave}>保存</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
