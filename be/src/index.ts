// WahtWay 后端入口 — V0.2 Express + SSE
// 启动: npm run dev

import "dotenv/config";
import express from "express";
import cors from "cors";
import chatRouter from "./routes/chat";
import skillsRouter from "./routes/skills";
import { runAgent } from "./agent";

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// API 路由
app.use("/api/chat", chatRouter);
app.use("/api/skills", skillsRouter);

// 健康检查
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "0.2.0" });
});

app.listen(PORT, () => {
  console.log(`🚀 WahtWay API running on http://localhost:${PORT}`);
  console.log(`   POST /api/chat  — 发送消息（SSE 流式）`);
  console.log(`   GET  /api/skills — 获取 Skill 列表`);
  console.log(`   GET  /api/health — 健康检查`);
});

// V0.1 CLI 模式保留：无参数启动时进入命令行交互
// 仅当没有其他参数时才启用（Express 启动后不再走 CLI）
if (process.argv.includes("--cli")) {
  import("./cli");
}
