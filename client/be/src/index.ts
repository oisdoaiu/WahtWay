// WahtWay 后端入口
// 启动: npm run dev (CLI 需先加载 dotenv)
// Electron 模式: 由 main.cjs 设置 process.env 后 require

import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import chatRouter from "./routes/chat";
import skillsRouter from "./routes/skills";
import conversationsRouter from "./routes/conversations";
import { initSkills, getSkillsDir } from "./skills/loader";
import { setModel, getCurrentModel } from "./agent";
import { registerTool } from "./tools/registry";
import { registerFileTools, approvePath } from "./tools/file-tools";
import { todoUpdateTool, clearTodo } from "./tools/todo-tool";

// 启动时加载 Skill + 注册 Tool
initSkills();
registerFileTools(registerTool);
registerTool(todoUpdateTool);

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// 托管前端静态文件（Vite 构建产物：client/dist/）
const publicDir = path.resolve(__dirname, "../../dist");
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

// API 路由
app.use("/api/chat", chatRouter);
app.use("/api/skills", skillsRouter);
app.use("/api/conversations", conversationsRouter);

// 临时授权：批准某个路径的操作
app.post("/api/tools/approve", (req, res) => {
  const { path: p } = req.body;
  if (!p) return res.status(400).json({ error: "请提供 path" });
  approvePath(p);
  console.log(`🔓 已授权路径: ${p}`);
  res.json({ success: true });
});

// 健康检查
// 重置：清空对话 + 清空用户创建的 Skill，保留内置 Skill
app.post("/api/reset", (_req, res) => {
  const convCandidates = [
    path.join(process.cwd(), "data", "conversations"),
    path.resolve(__dirname, "../data/conversations"),
  ];
  const convDir = convCandidates.find((d) => fs.existsSync(d)) || convCandidates[0];
  const skillsDir = getSkillsDir();
  const builtin = ["daily-study-plan", "code-explain"];
  try {
    if (fs.existsSync(convDir)) {
      fs.readdirSync(convDir).forEach((f) => fs.unlinkSync(path.join(convDir, f)));
    }
    if (fs.existsSync(skillsDir)) {
      fs.readdirSync(skillsDir)
        .filter((f) => !builtin.some((b) => f.startsWith(b)))
        .forEach((f) => fs.unlinkSync(path.join(skillsDir, f)));
    }
    initSkills();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/health", (_req, res) => {
  const hasKey = !!process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.startsWith("sk-") && process.env.DEEPSEEK_API_KEY.length > 20;
  res.json({ status: "ok", version: "0.17.0", needsSetup: !hasKey });
});

// 保存 API Key 到 .env
app.post("/api/setup", (req, res) => {
  const { apiKey, baseUrl, model } = req.body;
  if (!apiKey || typeof apiKey !== "string" || apiKey.length < 20) {
    res.status(400).json({ error: "请提供有效的 API Key" });
    return;
  }
  try {
    const envContent = [
      `DEEPSEEK_API_KEY=${apiKey.trim()}`,
      `DEEPSEEK_BASE_URL=${baseUrl?.trim() || "https://api.deepseek.com"}`,
      `DEEPSEEK_MODEL=${model?.trim() || "deepseek-chat"}`,
    ].join("\n");
    // 写入 .env（与 main.cjs loadEnv 的读取路径一致）
    const envPaths = [
      path.join(path.dirname(process.execPath), ".env"),  // Electron: EXE 同目录
      path.resolve(__dirname, "../../", ".env"),           // Dev: be/ 的上级 = client/
    ];
    const target = envPaths.find(p => { try { return fs.existsSync(path.dirname(p)); } catch { return false; } }) || envPaths[0];
    fs.writeFileSync(target, envContent, "utf-8");
    // 立即生效
    process.env.DEEPSEEK_API_KEY = apiKey.trim();
    if (baseUrl) process.env.DEEPSEEK_BASE_URL = baseUrl.trim();
    if (model) process.env.DEEPSEEK_MODEL = model.trim();
    console.log("🔑 API Key 已保存:", target);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: `保存失败: ${err.message}` });
  }
});

// SPA fallback：非 API 请求返回 index.html（前端路由）
if (fs.existsSync(publicDir)) {
  app.get("*", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`🚀 WahtWay running on http://localhost:${PORT}`);
});

// V0.1 CLI 模式保留：无参数启动时进入命令行交互
// 仅当没有其他参数时才启用（Express 启动后不再走 CLI）
if (process.argv.includes("--cli")) {
  import("./cli");
}
