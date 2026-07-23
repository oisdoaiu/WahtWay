# WahtWay — 何以委

WahtWay（何以委）是一个面向大学生的本地 AI Agent 桌面应用。它支持多模型对话、Skill 自动匹配、本地文件操作、外部 API 工具和 MCP Server，并可将配置与对话数据保存在本机。

## 功能

- 🤖 **智能对话**：实时流式回复、多轮对话、普通模式与指定 Skill 模式切换
- 🔧 **Tool 调用**：Agentic Loop 自动编排文件、命令、PPT、外部 API 和 MCP 工具
- 📊 **用量统计**：每轮对话显示 Token 消耗、耗时、工具调用次数，动态更新
- 📁 **文件管理**：读取、搜索、移动、复制、写入和解析文件，支持总结、翻译与格式化
- ◫ **MCP 连接器**：连接本地 stdio MCP Server，自动发现工具并注册到 Agent，默认逐次确认调用
- 📂 **工作区**：选择默认目录后，相对文件路径和命令执行目录自动基于该工作区
- 🔌 **外部工具**：将第三方 HTTPS API 配置为 Agent 工具，Secret 单独保存，写操作需要确认
- 🛡️ **安全护栏**：写操作需确认，系统目录拦截，敏感文件保护，临时授权机制
- 🧠 **Skill 系统**：内置多个 Skill + AI 自动生成 + 搜索推荐 + 一键创建
- 📦 **Skill Hub**：在线 Skill 库，浏览/搜索/下载安装，已部署 [Railway](https://wahtway-production.up.railway.app)
- 💻 **桌面 EXE**：Electron 便携版打包，API 配置和运行数据保存在本机

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 + TypeScript + Vite 5 |
| 后端 | Node.js + Express + TypeScript |
| 桌面端 | Electron 33 + electron-builder |
| AI | DeepSeek、OpenAI、通义千问、智谱、Moonshot、SiliconFlow 和自定义 OpenAI 兼容 API |
| 数据 | 本地 JSON 文件（对话、Skill、AI 配置、外部工具和 MCP 配置） |

## 前置要求

- **Node.js 20 或 22 LTS**（不建议使用非 LTS 版本）
- 至少一个受支持服务商的 **API Key**
- Windows 桌面打包需要能够下载 Electron 和 electron-builder 相关文件

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/oisdoaiu/WahtWay.git
cd WahtWay
```

### 2. 安装依赖

分别在三个 Node.js 应用中安装依赖。只使用客户端时，前两个目录是必需的；`server/` 仅用于本地运行 Skill Hub。

```powershell
cd client/be
npm ci

cd ../..
cd client
npm ci

cd ../server
npm ci
```

### 3. 浏览器开发模式

终端 1，启动客户端内嵌 API：

```powershell
cd client/be
npm run dev
```

终端 2，启动 Vite：

```powershell
cd client
npm run dev
```

访问 `http://localhost:5173`。第一次进入时，在“AI 配置”窗口选择服务商、模型并填写 API Key。配置保存在本机，不需要每次启动重新输入。

> 浏览器受安全限制，不能直接获得本地文件夹绝对路径。点击工作区时需要手工输入完整路径；桌面版可以使用原生文件夹选择窗口。

### 4. Electron 桌面模式

桌面模式会启动已经构建好的前端和内嵌 API，不需要另外运行两个开发服务器：

```powershell
cd client
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run build
npm run electron
```

修改代码后必须重新执行 `npm run build`，否则 Electron 打开的仍是旧构建。

### 5. 打包 Windows 便携 EXE

```powershell
cd client
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
$env:CSC_IDENTITY_AUTO_DISCOVERY="false"
npm run dist
```

生成文件位于 `client/release/WahtWay <版本号>.exe`。便携版运行数据默认保存在 EXE 同目录的 `WahtWay-data/` 中，不要将该目录提交到 Git。

---

## 基本使用流程

1. 打开“AI 配置”，选择 API 类型和模型，填写 API Key 后保存。
2. 在顶部选择工作区；不需要文件操作时可以保持“未设置工作区”。
3. 在“对话”中直接提问，或在顶部选择指定模型和 Skill。
4. 在“Skill 库”中创建、编辑、下载或启用 Skill。
5. 在“外部工具”中配置第三方 HTTPS API；写入型工具调用前会要求确认。
6. 在“MCP”中添加本地 stdio Server，测试连接、启动并查看发现的工具。

---

## 项目结构

```
WahtWay/
├── client/                       # Electron 客户端
│   ├── be/                       #   内嵌后端
│   │   ├── data/skills/          #   ★ 本地 Skill 定义（JSON 文件）
│   │   └── src/
│   │       ├── index.ts          #   Express 入口
│   │       ├── agent.ts          #   Agent 核心（流式 Agentic Loop）
│   │       ├── types.ts          #   类型定义
│   │       ├── routes/
│   │       │   ├── chat.ts       #   POST /api/chat（SSE 流式）
│   │       │   ├── skills.ts     #   Skill 读取、生成、保存和下载
│   │       │   ├── conversations.ts
│   │       │   ├── external-tools.ts
│   │       │   ├── ai-config.ts
│   │       │   └── mcp.ts        #   MCP Server CRUD + 生命周期
│   │       ├── external-tools/   #   第三方 HTTPS API 工具
│   │       ├── mcp/
│   │       │   ├── repository.ts  # 配置与 Secret 存储
│   │       │   └── runtime.ts     # stdio 进程 + 工具注册
│   │       ├── skills/
│   │       │   ├── loader.ts     #   JSON 文件加载与保存
│   │       │   ├── matcher.ts    #   Skill 匹配器
│   │       │   └── learning-engine.ts
│   │       └── tools/
│   │           ├── file-tools.ts #   文件读取、写入与解析工具
│   │           ├── command-tool.ts
│   │           ├── pptx-tools.ts
│   │           ├── workspace.ts  #   工作区路径解析
│   │           └── registry.ts   #   Tool 注册表
│   ├── src/                      #   前端 (React)
│   │   ├── App.tsx               #   对话、Skill、外部工具与 AI 配置
│   │   ├── conversations.ts      #   全局消息 store
│   │   ├── McpPanel.tsx           #   MCP Server 管理
│   │   └── debug.ts              #   调试工具
│   └── electron/                 #   Electron 壳
│
├── server/                       # Skill Hub 服务端
│   ├── data/skills/              #   Seed Skill
│   ├── src/
│   │   ├── index.ts              #   Express 入口（端口 4000）
│   │   ├── types.ts              #   类型定义
│   │   ├── routes/skills.ts      #   Hub API（CRUD/评分/举报）
│   │   └── skills/
│   │       ├── hubStore.ts       #   JSON 文件数据库
│   │       └── validation.ts     #   输入校验
│   └── public/                   #   Hub Web UI
│
└── .gitignore
```

---

## 如何加新 Skill

### 方法一：AI 自动生成（推荐）

点击界面右上角「+ 创建 Skill」，用自然语言描述需求（比如"我想要一个帮我写论文大纲的助手"），AI 会自动生成 Skill 定义。你可以编辑调整后保存，即刻生效。

### 方法二：手动创建 JSON 文件

```json
{
  "id": "my-skill",
  "name": "我的技能名",
  "description": "这个技能能做什么",
  "systemPrompt": "你是一个……（给 LLM 的系统提示词）",
  "input": {
    "type": "object",
    "properties": {},
    "required": []
  },
  "output": {
    "type": "object",
    "properties": {}
  },
  "requiredTools": [],
  "allowedTools": [],
  "whenToUse": "用户明确需要这个技能处理任务时",
  "keywords": ["关键词1", "关键词2", "关键词3"]
}
```

- `keywords` → 用户消息命中这些词则匹配该 Skill
- `systemPrompt` → 告诉 LLM 扮演什么角色，输出什么格式
- 不需要写任何代码，重启即生效

---

## 连接 MCP Server

打开侧栏的「MCP」，点击「添加 Server」。填写：

- 启动命令，例如 `node`、`npx` 或一个可执行文件的绝对路径
- 参数列表，必须是 JSON 数组，每个参数独立填写
- 可选工作目录
- 可选环境变量；敏感值使用 `${SECRET_NAME}` 引用，并通过 Secret 区域单独保存
- 是否随应用启动，以及默认工具权限（自动、每次确认或全部禁用）

保存后先点击「测试」。连接成功时，页面会显示 Server 提供的工具。启动 Server 后，工具以以下名称进入 Agent Tool Registry：

```text
mcp-<server-id>-<tool-name>
```

每个已发现工具可单独设置：

```text
继承默认   使用 Server 默认策略
自动调用   不弹出逐次确认
每次确认   使用一次性审批 token
禁用       不注册到 Agent Tool Registry
```

旧版 `requireApproval` 配置会在读取时兼容迁移，下一次保存后写为新的三态权限 schema。详细规则见 [`client/MCP_TOOL_PERMISSIONS.md`](client/MCP_TOOL_PERMISSIONS.md)。

MCP Server 是本地可执行程序。WahtWay 不自动安装 Server，也不通过 shell 拼接命令。只应运行来源可信、已经检查过启动命令和参数的 MCP Server。

MCP MVP 当前只支持本地 stdio transport；Streamable HTTP、OAuth、resources 和 prompts 留待后续版本。完整设计见 [`client/MCP_DESIGN.md`](client/MCP_DESIGN.md)。

### Skill 持续改进

观察器按上下文信号触发，而不是每轮固定调用。新对话或没有历史引用的手动 Skill 调用直接使用当前消息，不增加前置模型请求；自动匹配时，匹配模型会在同一次调用中返回需求快照。回答完成后只用本地规则记录工具失败、空回答等确定性问题。下一条消息只有表现为重复请求、纠正或补充约束时，才会在后台调用观察模型；明确继续和无关话题都由本地规则处理。

只有同类问题在至少 3 次调用中以高置信度重复出现，才会生成候选版本。候选版本只能修改 `systemPrompt`、`description`、`whenToUse` 和 `keywords`，不能改变工具权限或输入输出 Schema；通过历史案例判别回放后才自动激活。预设 Skill JSON 不会被覆盖，所有本地版本均可回退。

- `SKILL_OBSERVER_MODEL`：需求和差异观察模型，默认 `deepseek-v4-flash`
- `SKILL_OPTIMIZER_MODEL`：候选生成和版本评估模型，默认 `deepseek-v4-pro`
- 学习记录保存到 WahtWay 用户数据目录下的 `skill-learning/`
- 完整架构、触发策略和数据模型见 [`docs/Skill持续改进设计.md`](docs/Skill持续改进设计.md)

---

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat` | 发送消息，SSE 实时流式返回（含 delta/tool_call/stats） |
| GET | `/api/skills` | 获取本地 Skill 列表 |
| POST | `/api/skills/download` | 从 Hub 下载 Skill 到本地 |
| POST | `/api/skills/generate` | AI 自动生成 Skill JSON |
| POST | `/api/skills/save` | 保存新 Skill 到文件 |
| GET/POST | `/api/ai-config` | 读取或保存本机 AI 服务商配置 |
| GET/POST | `/api/conversations` | 读取列表或保存对话 |
| GET/POST | `/api/external-tools` | 读取或创建外部 HTTPS API 工具 |
| PATCH/DELETE | `/api/external-tools/:id` | 更新或删除外部工具 |
| POST | `/api/external-tools/:id/test` | 测试外部工具配置 |
| GET | `/api/agent-runs/pending` | 获取等待审批的 Agent 运行 |
| POST | `/api/agent-runs/:runId/approve` | 批准并恢复 Agent 运行 |
| POST | `/api/agent-runs/:runId/reject` | 拒绝并恢复 Agent 运行 |
| POST | `/api/tools/approve` | 临时授权文件操作路径 |
| GET | `/api/mcp/servers` | 获取 MCP Server 配置和运行状态 |
| POST | `/api/mcp/servers` | 创建 MCP Server 配置 |
| PATCH | `/api/mcp/servers/:id` | 更新 MCP Server 配置 |
| DELETE | `/api/mcp/servers/:id` | 停止并删除 MCP Server |
| POST | `/api/mcp/servers/:id/start` | 启动并发现 MCP 工具 |
| POST | `/api/mcp/servers/:id/stop` | 停止并注销 MCP 工具 |
| POST | `/api/mcp/servers/:id/restart` | 重启 MCP Server |
| POST | `/api/mcp/servers/:id/health` | 检查运行状态并按需重连 |
| POST | `/api/mcp/servers/:id/test` | 临时连接并测试工具发现 |
| PATCH | `/api/mcp/servers/:id/tool-permissions/default` | 修改 Server 默认工具权限 |
| PATCH | `/api/mcp/servers/:id/tool-permissions/:toolName` | 设置单个工具权限覆盖 |
| DELETE | `/api/mcp/servers/:id/tool-permissions/:toolName` | 删除覆盖并恢复继承默认权限 |
| POST | `/api/mcp/approve/execute` | 执行已确认的一次性 MCP 工具调用 |
| POST | `/api/reset` | 重置对话和自定义 Skill |
| GET | `/api/health` | 健康检查 |

> 在线 Skill Hub: [wahtway-production.up.railway.app](https://wahtway-production.up.railway.app)

---

## Commit 规范

| 前缀 | 含义 |
|------|------|
| `feat:` | 新功能 |
| `fix:` | 修 bug |
| `docs:` | 文档 |
| `refactor:` | 重构 |
| `chore:` | 杂项 |
