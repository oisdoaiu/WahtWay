# WahtWay — 何以委

面向大学生的 AI Agent + Skill 平台。输入问题，Agent 自动匹配合适的 Skill，调用 LLM 帮你搞定。支持用自然语言描述需求，AI 自动生成自定义 Skill。

## 功能

- 🤖 **智能对话**：流式逐字回复，多轮对话记忆，模式自由切换（普通/指定Skill）
- 📁 **文件管理**：查看、读取、搜索、移动、复制、删除（回收站式）、创建文件夹
- 🛡️ **安全护栏**：写操作需确认，系统目录拦截，敏感文件保护，临时授权机制
- 🧠 **Skill 系统**：内置多个 Skill + AI 自动生成 + 搜索推荐 + 一键创建
- 📦 **Skill Hub**（服务端）：在线 Skill 库，上传/下载/版本管理 + Web UI
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
DEEPSEEK_MODEL=deepseek-chat
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
├── be/                          # 后端
│   ├── data/skills/             # ★ Skill 定义（JSON 文件）
│   │   ├── daily-study-plan.json
│   │   └── code-explain.json
│   ├── src/
│   │   ├── index.ts             # Express 入口
│   │   ├── agent.ts             # Agent 核心（匹配 + 调 LLM）
│   │   ├── types.ts             # 类型定义
│   │   ├── cli.ts               # CLI 交互模式
│   │   ├── routes/
│   │   │   ├── chat.ts          # POST /api/chat（SSE 流式）
│   │   │   └── skills.ts        # Skill API（列表/生成/保存）
│   │   └── skills/
│   │       ├── loader.ts        # JSON 文件加载 + 保存
│   │       └── matcher.ts       # 关键词匹配器
│   ├── .env                     # API Key 配置
│   └── package.json
│
├── fe/                          # 前端
│   ├── src/
│   │   ├── App.tsx              # 对话界面
│   │   ├── App.css              # 样式
│   │   └── main.tsx             # 入口
│   ├── vite.config.ts           # Vite 配置（含 /api 代理）
│   └── package.json
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
| POST | `/api/chat` | 发送消息，SSE 流式返回 |
| GET | `/api/skills` | 获取所有 Skill 列表（不含 systemPrompt） |
| POST | `/api/skills/generate` | AI 自动生成 Skill JSON |
| POST | `/api/skills/save` | 保存新 Skill 到文件 |
| GET | `/api/health` | 健康检查 |

---

## Commit 规范

| 前缀 | 含义 |
|------|------|
| `feat:` | 新功能 |
| `fix:` | 修 bug |
| `docs:` | 文档 |
| `refactor:` | 重构 |
| `chore:` | 杂项 |
