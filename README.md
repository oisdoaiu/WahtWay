# WahtWay — 何以委

面向大学生的 AI Agent + Skill 平台。输入问题，Agent 自动匹配合适的 Skill，调用 LLM 帮你搞定。

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
│   │   │   └── skills.ts        # GET /api/skills
│   │   └── skills/
│   │       ├── loader.ts        # JSON 文件加载器
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

只需在 `be/data/skills/` 下新建一个 `.json` 文件，然后重启后端：

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
