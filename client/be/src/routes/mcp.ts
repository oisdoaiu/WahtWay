import { Router, Request, Response } from "express";
import {
  deleteMcpSecret,
  deleteMcpServer,
  getMcpServer,
  saveMcpServer,
  setMcpSecret,
} from "../mcp/repository";
import {
  checkMcpHealth,
  executeApprovedMcpTool,
  getMcpStatus,
  listPublicMcpServers,
  restartMcpServer,
  startMcpServer,
  stopMcpServer,
} from "../mcp/runtime";
import { McpServerConfig, McpToolPermission } from "../mcp/types";
import { listToolChangeAuditEvents } from "../mcp/tool-change-audit";

const router = Router();

function errorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  const messages: Record<string, string> = {
    INVALID_SERVER_ID: "Server ID 必须是 2-63 位小写字母、数字或连字符",
    NAME_REQUIRED: "请填写 Server 名称",
    DESCRIPTION_REQUIRED: "请填写 Server 描述",
    COMMAND_REQUIRED: "请填写启动命令",
    INVALID_NAME: "Server 名称格式无效",
    INVALID_DESCRIPTION: "Server 描述格式无效",
    INVALID_COMMAND: "启动命令格式无效",
    INVALID_CWD: "工作目录格式无效",
    INVALID_ARGS: "参数列表格式无效",
    TOO_MANY_ARGS: "启动参数不能超过 100 个",
    INVALID_ENV: "环境变量格式无效",
    TOO_MANY_ENV_VARS: "环境变量不能超过 100 个",
    INVALID_SECRET_NAME: "Secret 名称必须使用大写字母、数字和下划线",
    INVALID_SECRET_VALUE: "Secret 内容为空或超出长度限制",
    SERVER_NOT_FOUND: "MCP Server 不存在",
    INVALID_TOOL_PERMISSION: "工具权限必须是 auto、confirm 或 disabled",
    TOO_MANY_TOOL_PERMISSIONS: "工具权限覆盖不能超过 500 项",
    INVALID_TOOL_NAME: "MCP 工具名称格式无效",
  };
  return messages[code] || code;
}

function publicServer(id: string) {
  return listPublicMcpServers().find((server) => server.id === id) || null;
}

const TOOL_PERMISSIONS = new Set<McpToolPermission>(["auto", "confirm", "disabled"]);

function requestPermission(value: unknown): McpToolPermission {
  if (!TOOL_PERMISSIONS.has(value as McpToolPermission)) throw new Error("INVALID_TOOL_PERMISSION");
  return value as McpToolPermission;
}

async function updatePermissions(
  id: string,
  update: (server: McpServerConfig) => Partial<McpServerConfig>
) {
  const current = getMcpServer(id);
  if (!current) throw new Error("SERVER_NOT_FOUND");
  const wasRunning = getMcpStatus(id).state === "running";
  if (getMcpStatus(id).state !== "stopped") await stopMcpServer(id);
  saveMcpServer({ ...current, ...update(current), id });
  if (wasRunning) await startMcpServer(id);
  return publicServer(id);
}

router.get("/servers", (_req: Request, res: Response) => {
  res.json({ servers: listPublicMcpServers() });
});

router.post("/servers", (req: Request, res: Response) => {
  try {
    if (getMcpServer(String(req.body?.id || ""))) return res.status(409).json({ error: "Server ID 已存在" });
    const server = saveMcpServer(req.body);
    res.status(201).json(publicServer(server.id));
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/approve/execute", async (req: Request, res: Response) => {
  try {
    const output = await executeApprovedMcpTool(String(req.body?.token || ""));
    res.json({ success: true, output });
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.get("/servers/:id", (req: Request, res: Response) => {
  const server = publicServer(req.params.id);
  if (!server) return res.status(404).json({ error: "MCP Server 不存在" });
  res.json(server);
});

router.get("/servers/:id/tool-audit", (req: Request, res: Response) => {
  if (!getMcpServer(req.params.id)) return res.status(404).json({ error: "MCP Server does not exist" });
  const limit = Number(req.query.limit || 50);
  res.json({ events: listToolChangeAuditEvents(req.params.id, limit) });
});

router.patch("/servers/:id", async (req: Request, res: Response) => {
  try {
    const current = getMcpServer(req.params.id);
    if (!current) return res.status(404).json({ error: "MCP Server 不存在" });
    if (getMcpStatus(current.id).state !== "stopped") await stopMcpServer(current.id);
    const server = saveMcpServer({ ...req.body, id: current.id });
    res.json(publicServer(server.id));
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.patch("/servers/:id/tool-permissions/default", async (req: Request, res: Response) => {
  try {
    const permission = requestPermission(req.body?.permission);
    res.json(await updatePermissions(req.params.id, () => ({ defaultToolPermission: permission })));
  } catch (error) {
    const status = error instanceof Error && error.message === "SERVER_NOT_FOUND" ? 404 : 400;
    res.status(status).json({ error: errorMessage(error), status: getMcpStatus(req.params.id) });
  }
});

router.patch("/servers/:id/tool-permissions/:toolName", async (req: Request, res: Response) => {
  try {
    const permission = requestPermission(req.body?.permission);
    const toolName = req.params.toolName;
    if (!toolName || toolName.length > 256 || toolName.includes("\0")) throw new Error("INVALID_TOOL_NAME");
    res.json(await updatePermissions(req.params.id, (server) => ({
      toolPermissions: { ...server.toolPermissions, [toolName]: permission },
    })));
  } catch (error) {
    const status = error instanceof Error && error.message === "SERVER_NOT_FOUND" ? 404 : 400;
    res.status(status).json({ error: errorMessage(error), status: getMcpStatus(req.params.id) });
  }
});

router.delete("/servers/:id/tool-permissions/:toolName", async (req: Request, res: Response) => {
  try {
    const toolName = req.params.toolName;
    res.json(await updatePermissions(req.params.id, (server) => {
      const toolPermissions = { ...server.toolPermissions };
      delete toolPermissions[toolName];
      return { toolPermissions };
    }));
  } catch (error) {
    const status = error instanceof Error && error.message === "SERVER_NOT_FOUND" ? 404 : 400;
    res.status(status).json({ error: errorMessage(error), status: getMcpStatus(req.params.id) });
  }
});

router.delete("/servers/:id", async (req: Request, res: Response) => {
  try {
    if (!getMcpServer(req.params.id)) return res.status(404).json({ error: "MCP Server 不存在" });
    await stopMcpServer(req.params.id);
    deleteMcpServer(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/servers/:id/start", async (req: Request, res: Response) => {
  try {
    const status = await startMcpServer(req.params.id);
    res.json({ success: true, status });
  } catch (error) {
    res.status(400).json({ error: errorMessage(error), status: getMcpStatus(req.params.id) });
  }
});

router.post("/servers/:id/stop", async (req: Request, res: Response) => {
  try {
    const status = await stopMcpServer(req.params.id);
    res.json({ success: true, status });
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/servers/:id/restart", async (req: Request, res: Response) => {
  try {
    const status = await restartMcpServer(req.params.id);
    res.json({ success: true, status });
  } catch (error) {
    res.status(400).json({ error: errorMessage(error), status: getMcpStatus(req.params.id) });
  }
});

router.post("/servers/:id/health", async (req: Request, res: Response) => {
  try {
    const status = await checkMcpHealth(req.params.id);
    res.json({ success: true, status });
  } catch (error) {
    res.status(400).json({ error: errorMessage(error), status: getMcpStatus(req.params.id) });
  }
});

router.post("/servers/:id/test", async (req: Request, res: Response) => {
  try {
    const wasRunning = getMcpStatus(req.params.id).state === "running";
    const status = await startMcpServer(req.params.id);
    if (!wasRunning) await stopMcpServer(req.params.id);
    res.json({ success: true, tools: status.tools });
  } catch (error) {
    await stopMcpServer(req.params.id).catch(() => undefined);
    res.status(400).json({ error: errorMessage(error), status: getMcpStatus(req.params.id) });
  }
});

router.put("/servers/:id/secrets/:name", async (req: Request, res: Response) => {
  try {
    if (typeof req.body?.value !== "string") return res.status(400).json({ error: "请提供 Secret value" });
    if (getMcpStatus(req.params.id).state !== "stopped") await stopMcpServer(req.params.id);
    setMcpSecret(req.params.id, req.params.name, req.body.value);
    res.json(publicServer(req.params.id));
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.delete("/servers/:id/secrets/:name", async (req: Request, res: Response) => {
  try {
    if (getMcpStatus(req.params.id).state !== "stopped") await stopMcpServer(req.params.id);
    if (!deleteMcpSecret(req.params.id, req.params.name)) return res.status(404).json({ error: "Secret 不存在" });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

export default router;
