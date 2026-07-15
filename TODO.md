# WahtWay — 开发待办清单

> 更新：2026-07-16

---

## ✅ 已完成

| 版本 | 内容 |
|------|------|
| V0.1 | CLI Agent + 硬编码 Skill + DeepSeek API |
| V0.2 | Express + SSE 流式 + React 对话界面 + Markdown |
| V0.3 | JSON 文件加载 Skill + 关键词匹配 + 第二个 Skill |
| V0.4 | AI 自动生成 Skill（自然语言 → LLM → 保存） |
| V0.5 | 侧边栏 + Skill 库卡片页 |
| V0.6 | 前后端合一 + electron-builder 打包 EXE |
| V0.7 | 架构拆分：server/（Skill Hub）+ client/（Electron EXE） |
| V0.8 | LLM 语义匹配 + Skill 删除 + Electron 焦点 bug 修复 |
| V0.9 | Agentic Loop + 4 个文件操作 Tool（列出/读取/搜索/信息） |
| V0.10 | 多轮对话记忆（history 参数 + agenticLoop 注入历史） |
| V0.11 | 对话历史持久化 + 全局 store 架构重构 + Tool 使用规范 |
| V0.12 | 调试体系：结构化日志 + traceId 全链路追踪 + 日志文件导出 |
| V0.13 | 对话模式切换：普通对话 / Skill 模式 + 搜索下拉 + 思考可视化 |
| V0.14 | 文件写操作(5个Tool) + 安全护栏 + 权限弹窗 + 能力层重构 |
| V0.15 | Skill Hub 客户端对接 + 实时流式 Agentic Loop + Token/时间统计 |

---

## 🔲 待完成

### 🔴 高优先级

| # | 内容 | 说明 |
|---|------|------|
| 1 | ~~服务端部署上线~~ ✅ | server/ 部署 Railway，wahtway-production.up.railway.app |
| 2 | ~~客户端下载 Skill~~ ✅ | Hub 列表浏览/搜索/下载安装，已安装标记 |
| 3 | ~~更多文件 Tool~~ ✅ | move/copy/new-folder/write-file/delete-file(回收站) |
| 4 | **文件内容总结 Tool** | 读取文件后调 LLM 做摘要、翻译、格式化 |
| 5 | ~~Tool 执行前确认~~ ✅ | PERMISSION_REQUIRED 自动弹窗 + 授权后重试 |

### 🟡 中优先级

| # | 内容 | 说明 |
|---|------|------|
| 6 | ~~流式 Tool 调用~~ ✅ | Agentic Loop 全面改为 stream:true，delta/tool 事件实时推送 |
| 7 | **文件拖拽上传** | 聊天框拖入文件，自动识别路径 |
| 8 | **Skill 编辑器增强** | 在 Skill 库页面直接编辑已有 Skill 的 systemPrompt |
| 9 | **错误提示优化** | API 超时/断网时给出友好提示而非白屏 |
| 10 | **Tool 执行进度反馈** | Tool 调用耗时较长时前端展示进度 |

### 🟢 低优先级

| # | 内容 | 说明 |
|---|------|------|
| 11 | **多格式文件支持** | PDF、PPTX、Word 文件解析 Tool |
| 12 | **Skill 社区** | Skill 评分、评论、Fork、排行榜 |
| 13 | **用户系统** | 注册/登录，同步本地 Skill 配置 |
| 14 | **自定义主题** | 浅色/深色切换 + 自定义配色 |
| 15 | **快捷指令** | 命令行模式（`Ctrl+K`），输入 Skill 名直达 |
| 16 | **国际化 i18n** | 中英文切换 |
| 17 | **自动更新** | 客户端检测新版本 → 提示升级 |

---

## 💡 参考 ChatGPT 架构 — 可借鉴方向

> 来源：[ChatGPT Desktop Architecture Research](https://deepwiki.com/lencx/ChatGPT/2.3-multi-webview-system) 及 OpenAI 2025 年公开信息

| # | ChatGPT 做法 | 对 WahtWay 的启发 | 难度 |
|---|-------------|-----------------|:---:|
| 18 | **上下文分层**：Session Meta + User Memory + Recent Summaries + Current Messages 四层结构 | 给 Agent 加"用户画像"层：记住姓名、专业、偏好，跨对话复用 | 中 |
| 19 | **对话摘要轮换**：近 15 个对话自动摘要，不读全文，省 token | 对话列表里展示 AI 自动生成的摘要而非首条消息截断 | 中 |
| 20 | **Conversation Branching**：在任意消息右键 → 分支新对话，继承完整上下文 | 答辩亮点——演示"同一问题走两条路，AI 给出不同方案" | 中 |
| 21 | **Thread ID 内部追踪**：同一对话内换话题自动分配新 thread ID，逻辑分组 | 长对话中自动识别话题切换，UI 上展示分段标记 | 大 |
| 22 | **WebSocket 长连接**：30 分钟持久连接，心跳 45 秒，只推增量 diff | 当前 SSE 够用，用户上百后可升级 | 大 |
| 23 | **LevelDB 本地持久化**：WAL 日志，4MB 自动压缩，退出时才写盘 | 当前 JSON 文件够用，对话超千条后可考虑 | 大 |

### 参考 Claude Code / Agent Skills 标准 — 可借鉴方向

> 来源：Anthropic [Agent Skills 开放标准](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) + [Claude Code Skills Architecture](https://github.com/levnikolaevich/claude-code-skills/blob/master/docs/architecture/SKILL_ARCHITECTURE_GUIDE.md)

| # | 做法 | 对 WahtWay 的启发 | 难度 |
|---|------|-----------------|:---:|
| 24 | **whenToUse 字段**：Skill 声明触发场景和反例，"用户想制定学习计划时触发，不要在对文件操作或闲聊时触发" | 给每个 Skill JSON 加 `whenToUse`，匹配 prompt 里传给 LLM，精准度提升 | 小 |
| 25 | **allowed-tools 白名单**：Skill 声明自己能调哪些 Tool，不是所有 Tool 对所有 Skill 可见 | Skill JSON 加 `allowedTools: ["list-files", "read-file"]`，LLM 匹配时只给白名单 Tool | 小 |
| 26 | **两阶段加载**：启动时只载 name+description，匹配后才加载完整 systemPrompt | Skill 多了以后（>10 个）优化启动速度，当前 3 个 Skill 无瓶颈 | 中 |
| 27 | **上下文分叉 (fork)**：Skill 在隔离子对话中运行，不污染主对话 | 你们的 store 架构已铺好路——派生子对话，消息写同 store 不同 key | 中 |
| 28 | **7 级 Skill 来源优先级**：Managed > User > Project > Plugins > Bundled > MCP，同名取最高优先级 | Server Hub（远程）+ Client 本地（用户自建），同名冲突时给用户选择 | 中 |
| 29 | **15000 字符系统提示预算**：Skill 描述超过预算会被静默丢弃，描述应 <100 字 | 当前 Skill 数量少无问题，做成规范：description 控制在 50 字以内 | 小 |
| 30 | **Skill 目录结构**：SKILL.md + references/ + scripts/ + templates/ | 后续复杂 Skill 可参考：systemPrompt 放主文件，详细文档和脚本放子目录 | 大 |

---

## 🐛 已知问题

| # | 问题 | 状态 |
|---|------|:---:|
| 1 | 长时间无操作后 LLM 超时无友好提示 | 待修 |
| 2 | EXE 体积较大（~180MB，含 Electron + Chromium） | 待优化 |

### 参考 Anthropic Tool Use / OpenAI Agents SDK — 可借鉴方向

> 来源：[Anthropic Tool Use Best Practices](https://platform.claude.com/cookbook/tool-use-programmatic-tool-calling-ptc) + [OpenAI Agents SDK Patterns](https://developers.openai.com/cookbook/examples/agents_sdk/multi-agent-portfolio-collaboration/)

| # | 做法 | 对 WahtWay 的启发 | 难度 |
|---|------|-----------------|:---:|
| 31 | **input_examples**：Tool 定义加真实调用示例，Anthropic 数据 72%→90% 准确率 | 给现有 4 个 Tool 各加 2-3 个输入示例 | 小 |
| 32 | **Human-in-the-Loop**：危险 Tool 标记 `requiresApproval`，执行前弹确认框 | 后续做移动/删除 Tool 时直接加上确认机制 | 小 |
| 33 | **Composite Tools**：把多步操作（list+filter+move）封装为一个 Tool | 做 `organize-files` 之类复合 Tool，减少 LLM 往返 | 中 |
| 34 | **Tool 延迟加载 (defer_loading)**：低频 Tool 不列全量，按需通过 Tool Search 发现 | 超过 15 个 Tool 后用，当前 4 个不需要 | 大 |
| 35 | **MCP 协议**：开放标准，第三方可贡献标准化 Tool | 后续社区 Tool 市场用，当前不需要 | 远 |
| 36 | **Agent-as-Tool**：子 Agent 被包装为 Tool 供主 Agent 调用 | 复杂 Skill 需要独立推理时可封装为子 Agent，当前场景不需要 | 中 |

### 参考 Claude Code Agent 架构 — 可借鉴方向

> 来源：[Claude Code Agent Architecture](https://www.zenml.io/llmops-database/claude-code-agent-architecture-single-threaded-master-loop-for-autonomous-coding) + [Anthropic Building Production AI Agents](https://www.zenml.io/llmops-database/building-production-ai-agents-lessons-from-claude-code-and-enterprise-deployments)

| # | 做法 | 对 WahtWay 的启发 | 难度 |
|---|------|-----------------|:---:|
| 37 | **Todo/Planning 系统**：纯 prompt 驱动的 JSON 规划器，Agent 接到复杂任务自动拆解为子任务列表 | 加一个虚拟 Todo Tool，Agent 在对话中展示计划 → 逐步勾掉 | 中 |
| 38 | **文件系统记忆**：Agent 自己写 `.md` 摘要到临时目录，下次读自己的笔记而非重新扫描 | 加 `write-file` Tool + 约定笔记目录 `be/data/agent-notes/`，Agent 能给自己记笔记 | 小 |
| 39 | **Context 编辑/Compaction**：上下文快满 (92%) 时自动裁剪旧的中间工具结果 | conversations.ts store 加裁剪逻辑，当前对话长度不需要，后期加 | 大 |
| 40 | **子 Agent 分叉**：探索任务 fork 到独立上下文，跑完只返回摘要，不污染主对话 | store 已支持多 conversation，子 Agent = 起隐藏 conversation → 结果写回主对话 | 中 |
| 41 | **"Give it tools and get out of the way"**：相信模型自己会用工具，少写编排代码多写好的 Tool 描述 | 当前架构已遵循这个方向——全局 Tool + System Prompt 约束，保持住 | 理念 |
| 42 | **Checkpoint/恢复**：崩溃后从上次状态继续，不从头开始 | conversations.ts 已持久化每条消息，天然支持断点续聊 | 已做 |

---

## 📋 下个迭代建议

- **A. Agent 记忆**（#37 #38）：Todo规划 + 文件系统笔记，Agent 能给自己记东西
- **B. 小优化**（#24 #25 #31）：whenToUse + input_examples + allowed-tools，低投入高回报
- **C. 文件内容总结**（#4）：读取文件后调 LLM 做摘要、翻译、格式化
- **D. 对话摘要**（#19）：借鉴 ChatGPT，对话列表展示 AI 生成的摘要
