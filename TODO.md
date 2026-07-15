# WahtWay — 开发待办清单

> 更新：2026-07-15

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

---

## 🔲 待完成

### 🔴 高优先级

| # | 内容 | 说明 |
|---|------|------|
| 1 | **服务端部署上线** | server/ 部署到 Railway，提供在线 Skill Hub |
| 2 | **客户端下载 Skill** | 从服务端拉取 Skill 列表 → 下载 JSON → 安装到本地 |
| 3 | **更多文件 Tool** | 移动/复制/重命名/删除/新建文件夹 |
| 4 | **文件内容总结 Tool** | 读取文件后调 LLM 做摘要、翻译、格式化 |
| 5 | **Tool 执行前确认** | 涉及写操作（移动/删除）时弹确认框，避免误操作 |

### 🟡 中优先级

| # | 内容 | 说明 |
|---|------|------|
| 6 | **流式 Tool 调用** | Tool 循环期间也逐字输出（目前循环完再一次性推 delta） |
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

---

## 🐛 已知问题

| # | 问题 | 状态 |
|---|------|:---:|
| 1 | 长时间无操作后 LLM 超时无友好提示 | 待修 |
| 2 | EXE 体积较大（~180MB，含 Electron + Chromium） | 待优化 |

---

## 📋 下个迭代建议

可做的方向有三个，看你偏好：

- **A. 补齐文件 Tool**（#3 #4 #5）：移动/删除/重命名 + LLM 摘要，让文件助手真正能"干活"
- **B. 服务端闭环**（#1 #2）：Skill Hub 上线 + 客户端下载，答辩演示架构完整性
- **C. 对话摘要**（#19）：借鉴 ChatGPT，对话列表展示 AI 生成的摘要，体验档次提升明显
