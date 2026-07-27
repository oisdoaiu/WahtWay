# WahtWay

WahtWay 是一款面向学习、项目协作与本地文件处理场景的 AI Agent 桌面应用。项目以 Electron 客户端为主要运行形态，内嵌 React 前端与 Express API，支持多模型对话、Skill 系统、长期记忆、工作区文件工具、外部 HTTPS API 工具以及本地 stdio MCP Server 接入。

## 主要功能

- 🤖 **智能对话**：支持多轮对话、流式回复、智能模式与指定 Skill 模式切换。
- 🧠 **Skill 系统**：内置常用 Skill，支持 AI 生成、编辑、搜索、Hub 下载，以及从 GitHub/Gist URL 或仓库扫描导入。
- 🌐 **多 AI 接入**：支持 DeepSeek、OpenAI、通义千问、智谱、Moonshot、SiliconFlow，以及自定义 OpenAI 兼容接口。
- 📁 **工作区管理**：桌面端可选择本地文件夹作为工作区，文件读写与命令执行基于工作区进行路径解析。
- 📝 **长期记忆**：可将偏好、项目背景和长期事实保存到本地，并在后续对话中按需使用。
- 🔌 **MCP 接入**：支持配置本地 stdio MCP Server，测试连接、发现工具、设置权限并注册到 Agent。
- 🧩 **外部工具**：支持将第三方 HTTPS API 配置为 Agent 工具，Secret 单独保存，写入型调用需要确认。
- 📊 **文件与 PPT 工具**：支持文件读取、搜索、移动、复制、写入、删除到回收站，以及生成或填充 PPT。
- 🎨 **字体图标库**：前端界面使用 Remix Icon，避免直接使用 emoji 图标造成不同系统显示不一致。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 桌面端 | Electron 33 + electron-builder |
| 前端 | React 19 + TypeScript + Vite 5 |
| 内嵌 API | Node.js + Express + TypeScript |
| Skill Hub | Node.js + Express + TypeScript |
| 图标库 | Remix Icon |
| 数据存储 | 本地 JSON 文件 |

## 项目结构

```text
WahtWay/
├─ client/                 # Electron 桌面客户端
│  ├─ src/                 # React 前端
│  ├─ electron/            # Electron 主进程与 preload
│  ├─ be/                  # 客户端内嵌 Express API
│  │  ├─ src/
│  │  └─ data/skills/      # 客户端内置 Skill
│  ├─ dist/                # 前端构建产物，不提交
│  └─ release/             # exe 打包产物，不提交
├─ server/                 # 独立 Skill Hub 服务端
│  ├─ src/
│  ├─ public/
│  └─ data/skills/         # Hub seed Skill
├─ docs/                   # 设计、安全与格式规范
└─ schemas/                # Skill manifest schema
```

## 环境要求

- Node.js 20 或 22 LTS
- npm
- 至少一个可用的 AI 服务商 API Key
- Windows 打包 exe 时需要能够下载 Electron 与 electron-builder 相关二进制文件

## 安装依赖

首次拉取项目后，需要分别安装客户端前端、客户端内嵌后端和 Skill Hub 的依赖：

```powershell
cd client/be
npm ci

cd ../
npm ci

cd ../server
npm ci
```

日常运行桌面客户端主要依赖 `client/` 与 `client/be/`。`server/` 用于本地启动或调试独立 Skill Hub。

## 桌面端启动

推荐使用 Electron 桌面端运行应用。该方式会加载已经构建完成的前端页面与内嵌 API，不需要分别启动前端开发服务器和后端开发服务器。

```powershell
cd client
npm run build
npm run electron
```

说明：

- `npm run build` 会先构建 React 前端，再将 `client/be/src/index.ts` 打包到 `client/be/dist/index.js`。
- `npm run electron` 会启动 Electron，并由主进程加载内嵌 API。
- 修改代码后需要重新执行 `npm run build`，否则 Electron 会继续使用上一次构建产物。
- 如果 PowerShell 环境中残留 `ELECTRON_RUN_AS_NODE`，可先执行：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

首次进入应用时，在“AI 配置”中选择服务商、模型并填写 API Key。配置保存在本机，不应提交 `.env` 或密钥文件。

## Windows EXE 打包

Windows 便携版 exe 使用以下命令打包：

```powershell
cd client
npm run dist
```

`npm run dist` 会先执行 `npm run build`，再执行 `electron-builder --win --publish never`。

生成文件位于：

```text
client/release/WahtWay-<version>-win-<arch>.exe
```

当前打包配置说明：

- Windows target 为 `portable`，产物是便携版 exe。
- `asar` 当前设置为 `false`，便于内嵌后端直接访问文件。
- 打包内容包括 `electron/`、前端 `dist/`、内嵌后端 `be/dist/`、内置 Skill 与后端运行依赖。
- 便携版运行数据默认保存到 exe 同目录下的 `WahtWay-data/`。
- 未配置应用图标时，electron-builder 会使用默认 Electron 图标。
- 未配置签名证书时，打包流程会跳过代码签名。

如果下载 Electron 相关二进制文件较慢，可临时设置镜像：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist
```

不要提交 `client/release/`、`dist/`、`.env`、日志、对话记录或本地运行数据。

## 浏览器开发调试

浏览器开发模式仅用于前后端热更新联调。此方式需要两个终端分别启动内嵌 API 与 Vite。

终端 1：

```powershell
cd client/be
npm run dev
```

终端 2：

```powershell
cd client
npm run dev
```

访问：

```text
http://localhost:5173
```

浏览器模式受安全限制，不能像 Electron 桌面端一样直接使用原生文件夹选择窗口。涉及工作区路径与本地文件操作时，建议使用桌面端。

## Skill Hub

线上 Skill Hub：

```text
https://wahtway-production.up.railway.app
```

本地启动 Skill Hub：

```powershell
cd server
npm run build
npm run start
```

开发模式：

```powershell
cd server
npm run dev
```

默认端口为 `4000`。客户端如需切换 Hub 地址，可通过后端环境变量 `SKILL_HUB_URL` 配置。

## MCP 使用说明

打开侧边栏“MCP”，添加本地 stdio MCP Server。常用配置项如下：

- Server ID：项目内部用于标识该 MCP Server 的唯一 ID，例如 `drawio`、`filesystem`。
- 启动命令：例如 `node`、`npx`，或某个可执行文件的绝对路径。
- 参数列表：JSON 数组，每个命令行参数独立填写。
- 工作目录：可选。
- 环境变量：可选，敏感值建议通过 Secret 引用。
- 工具权限：可设置自动调用、每次确认或禁用。

保存后应先执行“测试”，确认能够发现工具；再启动 Server，使工具注册到 Agent。

## 常用命令

| 目录 | 命令 | 说明 |
| --- | --- | --- |
| `client` | `npm run build` | 构建桌面端所需的前端与内嵌后端 |
| `client` | `npm run electron` | 启动 Electron 桌面端 |
| `client` | `npm run dist` | 构建并打包 Windows 便携版 exe |
| `client` | `npm run dev` | 启动 Vite 前端开发服务器 |
| `client/be` | `npm run dev` | 启动内嵌 API 开发服务器 |
| `server` | `npm run build` | 编译 Skill Hub |
| `server` | `npm run start` | 启动编译后的 Skill Hub |
| `server` | `npm run dev` | 启动 Skill Hub 开发模式 |

## 提交规范

提交信息建议使用 Conventional Commit 风格：

- `feat:` 新功能
- `fix:` 修复问题
- `docs:` 文档
- `refactor:` 重构
- `chore:` 构建、依赖或杂项

## 安全提醒

- 不要提交 `.env`、API Key、日志、对话数据、打包产物或运行数据。
- 文件工具相关修改需要遵守 `docs/文件操作安全规范.md`。
- MCP Server 是本地可执行程序，只应运行来源可信、命令和参数已经检查过的 Server。
