import { randomUUID } from "crypto";
import * as fs from "fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ToolDef } from "../types";
import { getTool, registerTool, unregisterTool } from "../tools/registry";
import { getMcpSecrets, getMcpServer, listMcpServers, listMcpSecretNames } from "./repository";
import { McpServerConfig, McpServerStatus, McpToolPermission, McpToolSummary, PendingMcpApproval, PublicMcpServer } from "./types";

interface ActiveMcpServer {
  client: Client;
  transport: StdioClientTransport;
  registeredNames: string[];
  closing: boolean;
}

const activeServers = new Map<string, ActiveMcpServer>();
const statuses = new Map<string, McpServerStatus>();
const operations = new Map<string, Promise<unknown>>();
const pendingApprovals = new Map<string, PendingMcpApproval>();
const RESULT_LIMIT = 64 * 1024;

function defaultStatus(): McpServerStatus {
  return { state: "stopped", tools: [], startedAt: null, lastError: null };
}

function statusFor(id: string): McpServerStatus {
  return statuses.get(id) || defaultStatus();
}

function updateStatus(id: string, patch: Partial<McpServerStatus>): McpServerStatus {
  const status = { ...statusFor(id), ...patch };
  statuses.set(id, status);
  return status;
}

function serialize<T>(id: string, task: () => Promise<T>): Promise<T> {
  const previous = operations.get(id) || Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  operations.set(id, next);
  next.finally(() => {
    if (operations.get(id) === next) operations.delete(id);
  }).catch(() => undefined);
  return next;
}

function interpolate(value: string, secrets: Record<string, string>): string {
  return value.replace(/\$\{([A-Z][A-Z0-9_]+)\}/g, (_match, name) => {
    if (!(name in secrets)) throw new Error(`缺少 MCP Secret: ${name}`);
    return secrets[name];
  });
}

function childEnvironment(config: McpServerConfig): Record<string, string> {
  const secrets = getMcpSecrets(config.id);
  return {
    ...getDefaultEnvironment(),
    ...Object.fromEntries(Object.entries(config.env).map(([name, value]) => [name, interpolate(value, secrets)])),
  };
}

function registeredToolName(serverId: string, toolName: string): string {
  const normalized = toolName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "tool";
  return `mcp-${serverId}-${normalized}`.slice(0, 64);
}

export function resolveMcpToolPermission(config: McpServerConfig, toolName: string): McpToolPermission {
  return config.toolPermissions[toolName] || config.defaultToolPermission;
}

function formatMcpResult(result: any): string {
  const sections: string[] = [];
  if (result?.structuredContent !== undefined) sections.push(JSON.stringify(result.structuredContent, null, 2));
  if (Array.isArray(result?.content)) {
    for (const block of result.content) {
      if (block?.type === "text" && typeof block.text === "string") sections.push(block.text);
      else if (block?.type) sections.push(`[MCP content: ${String(block.type)}]`);
    }
  }
  const output = sections.filter(Boolean).join("\n\n") || "(MCP tool returned no text content)";
  return `${result?.isError ? "错误: " : ""}${output}`.slice(0, RESULT_LIMIT);
}

function createApproval(serverId: string, toolName: string, args: Record<string, unknown>): string {
  const token = randomUUID();
  pendingApprovals.set(token, {
    token,
    serverId,
    toolName,
    args: structuredClone(args),
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  return token;
}

async function invoke(serverId: string, toolName: string, args: Record<string, unknown>): Promise<string> {
  const active = activeServers.get(serverId);
  const config = getMcpServer(serverId);
  if (!active || !config || statusFor(serverId).state !== "running") throw new Error("MCP Server 未运行");
  const result = await active.client.callTool(
    { name: toolName, arguments: args },
    undefined,
    { timeout: config.toolCallTimeoutMs }
  );
  return formatMcpResult(result);
}

export async function executeConfirmedMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  const config = getMcpServer(serverId);
  if (!config || resolveMcpToolPermission(config, toolName) !== "confirm") {
    throw new Error("MCP tool permission changed; start a new request");
  }
  return invoke(serverId, toolName, args);
}

function unregisterServerTools(serverId: string): void {
  const active = activeServers.get(serverId);
  for (const name of active?.registeredNames || []) unregisterTool(name);
}

async function discoverAndRegister(
  config: McpServerConfig,
  client: Client,
  active: ActiveMcpServer
): Promise<McpToolSummary[]> {
  const summaries: McpToolSummary[] = [];
  const names = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: 15000 });
    for (const tool of page.tools) {
      const registeredName = registeredToolName(config.id, tool.name);
      const permission = resolveMcpToolPermission(config, tool.name);
      if (names.has(registeredName)) throw new Error(`MCP Tool 名称冲突: ${registeredName}`);
      if (permission !== "disabled" && getTool(registeredName)) throw new Error(`MCP Tool 名称冲突: ${registeredName}`);
      names.add(registeredName);
      const summary: McpToolSummary = {
        name: tool.name,
        registeredName,
        description: tool.description || `MCP tool ${tool.name}`,
        inputSchema: tool.inputSchema as Record<string, unknown>,
        permission,
        overridden: Object.prototype.hasOwnProperty.call(config.toolPermissions, tool.name),
      };
      if (permission !== "disabled") {
        const definition: ToolDef = {
          name: registeredName,
          description: `${summary.description}\nMCP Server: ${config.name}\n权限: ${permission}`,
          parameters: summary.inputSchema as any,
          execute: async (args) => {
            try {
              const current = getMcpServer(config.id);
              if (!current) return "错误: MCP Server 配置不存在";
              const currentPermission = resolveMcpToolPermission(current, tool.name);
              if (currentPermission === "disabled") return "错误: MCP 工具已禁用";
              if (currentPermission === "confirm") {
                const token = createApproval(config.id, tool.name, args);
                return `MCP_PERMISSION_REQUIRED::${config.id}::${tool.name}::${token}`;
              }
              return await invoke(config.id, tool.name, args);
            } catch (error) {
              return `错误: ${error instanceof Error ? error.message : String(error)}`;
            }
          },
        };
        registerTool(definition);
        active.registeredNames.push(registeredName);
      }
      summaries.push(summary);
    }
    cursor = page.nextCursor;
  } while (cursor);
  return summaries;
}

async function startInternal(id: string): Promise<McpServerStatus> {
  const config = getMcpServer(id);
  if (!config) throw new Error("MCP Server 不存在");
  if (!config.enabled) throw new Error("MCP Server 已禁用");
  if (activeServers.has(id) && statusFor(id).state === "running") return statusFor(id);
  if (config.cwd && (!fs.existsSync(config.cwd) || !fs.statSync(config.cwd).isDirectory())) {
    throw new Error("MCP Server 工作目录不存在");
  }

  updateStatus(id, { state: "starting", tools: [], startedAt: null, lastError: null });
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    cwd: config.cwd || undefined,
    env: childEnvironment(config),
    stderr: "pipe",
  });
  const client = new Client({ name: "wahtway", version: "0.1.0" });
  const active: ActiveMcpServer = { client, transport, registeredNames: [], closing: false };
  activeServers.set(id, active);

  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-4000); });
  client.onerror = (error) => updateStatus(id, { lastError: error.message });
  client.onclose = () => {
    unregisterServerTools(id);
    activeServers.delete(id);
    if (!active.closing) {
      updateStatus(id, { state: "error", tools: [], lastError: stderr.trim() || "MCP Server 连接已关闭" });
    }
  };

  try {
    await client.connect(transport, { timeout: 15000 });
    const tools = await discoverAndRegister(config, client, active);
    return updateStatus(id, { state: "running", tools, startedAt: new Date().toISOString(), lastError: null });
  } catch (error) {
    active.closing = true;
    unregisterServerTools(id);
    activeServers.delete(id);
    await client.close().catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    updateStatus(id, { state: "error", tools: [], startedAt: null, lastError: stderr.trim() || message });
    throw new Error(stderr.trim() || message);
  }
}

async function stopInternal(id: string): Promise<McpServerStatus> {
  const active = activeServers.get(id);
  if (active) {
    active.closing = true;
    unregisterServerTools(id);
    activeServers.delete(id);
    await active.client.close().catch(() => undefined);
  }
  for (const [token, approval] of pendingApprovals) {
    if (approval.serverId === id) pendingApprovals.delete(token);
  }
  return updateStatus(id, { state: "stopped", tools: [], startedAt: null, lastError: null });
}

export function startMcpServer(id: string): Promise<McpServerStatus> {
  return serialize(id, () => startInternal(id));
}

export function stopMcpServer(id: string): Promise<McpServerStatus> {
  return serialize(id, () => stopInternal(id));
}

export function restartMcpServer(id: string): Promise<McpServerStatus> {
  return serialize(id, async () => {
    await stopInternal(id);
    return startInternal(id);
  });
}

export async function executeApprovedMcpTool(token: string): Promise<string> {
  const approval = pendingApprovals.get(token);
  pendingApprovals.delete(token);
  if (!approval || approval.expiresAt < Date.now()) throw new Error("MCP 工具审批已失效，请重新发起");
  const config = getMcpServer(approval.serverId);
  if (!config || resolveMcpToolPermission(config, approval.toolName) !== "confirm") {
    throw new Error("MCP 工具权限已改变，请重新发起调用");
  }
  return invoke(approval.serverId, approval.toolName, approval.args);
}

export function getMcpStatus(id: string): McpServerStatus {
  return structuredClone(statusFor(id));
}

export function listPublicMcpServers(): PublicMcpServer[] {
  return listMcpServers().map((server) => ({
    ...server,
    secretNames: listMcpSecretNames(server.id),
    status: getMcpStatus(server.id),
  }));
}

export async function autoStartMcpServers(): Promise<void> {
  for (const server of listMcpServers().filter((item) => item.enabled && item.autoStart)) {
    startMcpServer(server.id).catch((error) => {
      console.warn(`MCP Server ${server.id} auto-start failed:`, error instanceof Error ? error.message : error);
    });
  }
}

export async function stopAllMcpServers(): Promise<void> {
  await Promise.all(Array.from(activeServers.keys()).map((id) => stopMcpServer(id)));
}
