# WahtWay — 何以委

面向大学生的 AI Agent + Skill 平台。输入问题，Agent 自动匹配合适的 Skill，调用 LLM 帮你搞定。支持用自然语言描述需求，AI 自动生成自定义 Skill。

## 功能

- 🤖 **智能对话**：实时流式逐字回复，多轮对话记忆，模式自由切换（普通/指定Skill）
- 🔧 **Tool 调用**：9 个文件操作 Tool，Agentic Loop 自动编排，实时可见，支持 input_examples 精准调用
- 📊 **用量统计**：每轮对话显示 Token 消耗、耗时、工具调用次数，动态更新
- 📁 **文件管理**：10个文件操作Tool + AI文件总结/翻译/格式化
- 🧠 **Agent认知**：Todo任务规划 + 跨对话文件记忆 + 工作区目录
- 🛡️ **安全护栏**：写操作需确认，系统目录拦截，敏感文件保护，临时授权机制
- 🧠 **Skill 系统**：内置多个 Skill + AI 自动生成 + 搜索推荐 + 一键创建
- 📦 **Skill Hub**：在线 Skill 库，浏览/搜索/下载安装，已部署 [Railway](https://wahtway-production.up.railway.app)
- 💻 **桌面 EXE**：Electron 打包，双击即用，无需安装环境

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + TypeScript + Vite |
| 后端 | Node.js + Express + TypeScript |
| AI | DeepSeek API（OpenAI 兼容格式） |
| 数据 | JSON 文件（Skill 定义）+ SQLite（计划中） |

## 前置要求

- **Node.js** >= 18（[下载](https://nodejs.org) LTS 版本）
- **DeepSeek API Key**（[申请](https://platform.deepseek.com)）

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/oisdoaiu/WahtWay.git
cd WahtWay
```

### 2. 配置 API Key

在 `be/.env` 中填入你的 DeepSeek API Key：

```
DEEPSEEK_API_KEY=sk-你的key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

### 3. 安装依赖

```bash
# 后端
cd be
npm install

# 前端（另开终端）
cd fe
npm install
```

### 4. 启动

**终端 1 — 启动后端**（端口 3000）：

```bash
cd be
npm run dev
```

看到 `🚀 WahtWay API running on http://localhost:3000` 即启动成功。

**终端 2 — 启动前端**（端口 5173）：

```bash
cd fe
npm run dev
```

### 5. 打开浏览器

访问 **http://localhost:5173**，开始对话。

---

## 项目结构

```
WahtWay/
├── client/                       # Electron 客户端
│   ├── be/                       #   内嵌后端
│   │   ├── data/skills/          #   ★ 本地 Skill 定义（JSON 文件）
│   │   ├── data/conversations/   #   对话历史持久化
│   │   └── src/
│   │       ├── index.ts          #   Express 入口
│   │       ├── agent.ts          #   Agent 核心（流式 Agentic Loop）
│   │       ├── types.ts          #   类型定义
│   │       ├── routes/
│   │       │   ├── chat.ts       #   POST /api/chat（SSE 流式）
│   │       │   ├── skills.ts     #   Skill API + Hub 代理
│   │       │   └── conversations.ts
│   │       ├── skills/
│   │       │   ├── loader.ts     #   JSON 文件加载 + 保存
│   │       │   └── matcher.ts    #   LLM 语义匹配器
│   │       └── tools/
│   │           ├── file-tools.ts #   9 个文件操作 Tool
│   │           └── registry.ts   #   Tool 注册表
│   ├── src/                      #   前端 (React)
│   │   ├── App.tsx               #   对话界面 + Skill 库 + Hub
│   │   ├── conversations.ts      #   全局消息 store
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
  "keywords": ["关键词1", "关键词2", "关键词3"]
}
```

- `keywords` → 用户消息命中这些词则匹配该 Skill
- `systemPrompt` → 告诉 LLM 扮演什么角色，输出什么格式
- 不需要写任何代码，重启即生效

---

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat` | 发送消息，SSE 实时流式返回（含 delta/tool_call/stats） |
| GET | `/api/skills` | 获取本地 Skill 列表 |
| GET | `/api/skills/hub/list` | 代理 Hub 列表（支持 q/sort/category） |
| POST | `/api/skills/download` | 从 Hub 下载 Skill 到本地 |
| POST | `/api/skills/generate` | AI 自动生成 Skill JSON |
| POST | `/api/skills/save` | 保存新 Skill 到文件 |
| GET | `/api/skills/search?q=` | 模糊搜索本地 Skill |
| POST | `/api/tools/approve` | 临时授权文件操作路径 |
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
