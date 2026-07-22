// WahtWay 后端入口
// 启动: npm run dev（自动加载本地 .env）
// Electron 模式: 由 main.cjs 设置 process.env 后 require

import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import chatRouter from "./routes/chat";
import skillsRouter from "./routes/skills";
import conversationsRouter from "./routes/conversations";
import externalToolsRouter from "./routes/external-tools";
import aiConfigRouter from "./routes/ai-config";
import mcpRouter from "./routes/mcp";
import agentRunsRouter from "./routes/agent-runs";
import { initSkills, getSkillsDir } from "./skills/loader";
import { registerTool } from "./tools/registry";
import { registerFileTools, approvePath } from "./tools/file-tools";
import { todoUpdateTool, clearTodo } from "./tools/todo-tool";
import { runCommandTool, approveAndExecute, clearApprovedCommands } from "./tools/command-tool";
import { refreshExternalTools } from "./external-tools/registry";
import { autoStartMcpServers, stopAllMcpServers } from "./mcp/runtime";
import { getConversationsDir, getSkillLearningDir, migrateLegacyConversations } from "./runtime-data";
import { readPptTool, createPptTool, fillTemplateTool } from "./tools/pptx-tools";
import {
  getAiSettings,
  getPublicAiSettings,
  isAiConfigured,
  loadAiSettings,
  saveAiSettings,
} from "./ai-settings";

// 启动时加载 Skill + 注册 Tool
migrateLegacyConversations();
loadAiSettings();
initSkills();
registerFileTools(registerTool);
registerTool(todoUpdateTool);
registerTool(runCommandTool);
refreshExternalTools();
void autoStartMcpServers();
registerTool(readPptTool);
registerTool(createPptTool);
registerTool(fillTemplateTool);

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
app.use("/api/ai-config", aiConfigRouter);
app.use("/api/external-tools", externalToolsRouter);
app.use("/api/mcp", mcpRouter);
app.use("/api/agent-runs", agentRunsRouter);

// 临时授权：批准某个路径的操作
app.post("/api/tools/approve", (req, res) => {
  const { path: p } = req.body;
  if (!p) return res.status(400).json({ error: "请提供 path" });
  approvePath(p);
  console.log(`🔓 已授权路径: ${p}`);
  res.json({ success: true });
});

// 清除命令审批缓存（新对话时调用）
app.post("/api/tools/clear-approvals", (_req, res) => {
  clearApprovedCommands();
  res.json({ success: true });
});

// 命令审批：批准后立即执行并缓存结果
app.post("/api/tools/approve-command", async (req, res) => {
  const { command, cwd } = req.body;
  if (!command) { res.status(400).json({ error: "请提供 command" }); return; }
  try {
    const result = await approveAndExecute(command, cwd || require("os").homedir());
    console.log(`💻 已执行命令: ${command}`);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 健康检查
// 重置：清空对话 + 清空用户创建的 Skill，保留内置 Skill
app.post("/api/reset", (_req, res) => {
  const convDir = getConversationsDir();
  const skillsDir = getSkillsDir();
  const builtin = ["daily-study-plan", "code-explain"];
  try {
    if (fs.existsSync(convDir)) {
      fs.readdirSync(convDir)
        .filter((f) => /^\d+\.json$/.test(f))
        .forEach((f) => fs.unlinkSync(path.join(convDir, f)));
    }
    if (fs.existsSync(skillsDir)) {
      fs.readdirSync(skillsDir)
        .filter((f) => !builtin.some((b) => f.startsWith(b)))
        .forEach((f) => fs.unlinkSync(path.join(skillsDir, f)));
    }
    const learningDir = getSkillLearningDir();
    if (fs.existsSync(learningDir)) fs.rmSync(learningDir, { recursive: true, force: true });
    initSkills();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "0.17.0", needsSetup: !isAiConfigured(), settings: getPublicAiSettings() });
});

app.get("/api/balance", async (_req, res) => {
  const settings = getAiSettings();
  if (!settings.apiKey) {
    res.status(400).json({ error: "请先配置 API Key" });
    return;
  }
  if (!settings.balancePath) {
    res.status(400).json({ error: "当前 API 未配置余额查询地址" });
    return;
  }

  try {
    const url = new URL(settings.balancePath, settings.baseURL).toString();
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${settings.apiKey}` },
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      res.status(response.status).json({ error: data?.message || data?.error?.message || "余额查询失败" });
      return;
    }

    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: `余额查询失败: ${err.message}` });
  }
});

// 保存 AI 配置到本地 settings
app.post("/api/setup", (req, res) => {
  try {
    const current = getAiSettings();
    const { apiKey, baseUrl, model, provider, balancePath, modelOptions } = req.body;
    const nextApiKey = typeof apiKey === "string" ? apiKey.trim() : undefined;
    if (!current.apiKey && !nextApiKey) {
      res.status(400).json({ error: "请先输入 API Key" });
      return;
    }
    const settings = saveAiSettings({
      provider,
      apiKey: nextApiKey === "" ? (current.apiKey || "") : nextApiKey,
      baseURL: typeof baseUrl === "string" && baseUrl.trim() ? baseUrl.trim() : undefined,
      model: typeof model === "string" && model.trim() ? model.trim() : undefined,
      balancePath: typeof balancePath === "string" ? balancePath : undefined,
      modelOptions: Array.isArray(modelOptions) ? modelOptions : undefined,
    });
    console.log("🔑 AI 配置已保存:", settings.provider, settings.baseURL);
    res.json({ success: true, settings: getPublicAiSettings() });
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

function startServer(port: number, maxRetries = 10) {
  const server = app.listen(port, () => {
    console.log(`🚀 WahtWay running on http://localhost:${port}`);
    // 写入端口文件供 Electron 读取
    try {
      const pkgDir = path.resolve(__dirname, "..");
      fs.writeFileSync(path.join(pkgDir, ".port"), String(port), "utf-8");
    } catch {}
  });
  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE" && maxRetries > 0) {
      console.log(`端口 ${port} 被占用，尝试 ${port + 1}…`);
      startServer(port + 1, maxRetries - 1);
    } else {
      console.error("启动失败:", err.message);
    }
  });
}
startServer(Number(PORT));

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await stopAllMcpServers().catch(() => undefined);
  process.exit(0);
}
process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });

// V0.1 CLI 模式保留：无参数启动时进入命令行交互
// 仅当没有其他参数时才启用（Express 启动后不再走 CLI）
if (process.argv.includes("--cli")) {
  import("./cli");
}
