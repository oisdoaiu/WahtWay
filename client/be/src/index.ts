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

// 启动时加载 Skill + 注册 Tool
initSkills();
registerFileTools(registerTool);

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
  res.json({ status: "ok", version: "0.6.0" });
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
