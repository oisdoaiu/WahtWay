import { McpRuntimeState, McpToolPermission } from "../mcp/types";
import { listPublicMcpServers } from "../mcp/runtime";
import { Skill } from "../types";
import { getAllTools } from "../tools/registry";

export type SkillDependencyStatus = "healthy" | "degraded" | "unavailable";
export type SkillDependencyIssueSeverity = "warning" | "blocking";
export type SkillDependencyIssueCode =
  | "required_tool_missing"
  | "required_tool_not_allowed"
  | "optional_tool_missing"
  | "mcp_server_missing"
  | "mcp_server_disabled"
  | "mcp_server_not_running"
  | "mcp_tool_missing"
  | "mcp_tool_disabled"
  | "mcp_tool_not_allowed"
  | "mcp_registered_name_changed"
  | "mcp_tool_unregistered";

export interface SkillDependencyIssue {
  code: SkillDependencyIssueCode;
  severity: SkillDependencyIssueSeverity;
  message: string;
  toolName?: string;
  serverId?: string;
  registeredName?: string;
  suggestedRegisteredName?: string;
  serverState?: McpRuntimeState;
}

export interface SkillBindingHealth {
  serverId: string;
  serverName?: string;
  toolName: string;
  registeredName: string;
  currentRegisteredName?: string;
  serverState?: McpRuntimeState;
  permission?: McpToolPermission;
  status: "healthy" | "unavailable";
  issueCodes: SkillDependencyIssueCode[];
}

export interface SkillDependencyHealth {
  status: SkillDependencyStatus;
  runnable: boolean;
  checkedAt: string;
  issues: SkillDependencyIssue[];
  bindings: SkillBindingHealth[];
}

export interface SkillDependencyServerSnapshot {
  id: string;
  name?: string;
  enabled: boolean;
  status: {
    state: McpRuntimeState;
    lastError?: string | null;
    tools: Array<{
      name: string;
      registeredName: string;
      permission?: McpToolPermission;
    }>;
  };
}

export interface SkillDependencySnapshot {
  servers: SkillDependencyServerSnapshot[];
  registeredToolNames: string[];
  checkedAt: string;
}

function serverStateLabel(state: McpRuntimeState): string {
  switch (state) {
    case "starting": return "正在启动";
    case "running": return "运行中";
    case "reconnecting": return "正在重连";
    case "error": return "运行异常";
    default: return "已停止";
  }
}

export function evaluateSkillDependencies(
  skill: Skill,
  servers: SkillDependencyServerSnapshot[],
  registeredToolNames: Iterable<string>,
  checkedAt = new Date().toISOString()
): SkillDependencyHealth {
  const toolNames = new Set(registeredToolNames);
  const serverById = new Map(servers.map((server) => [server.id, server]));
  const bindingNames = new Set((skill.mcpBindings || []).map((binding) => binding.registeredName));
  const hasToolWhitelist = Array.isArray(skill.allowedTools) && skill.allowedTools.length > 0;
  const allowedTools = new Set(skill.allowedTools || []);
  const issues: SkillDependencyIssue[] = [];
  const bindings: SkillBindingHealth[] = [];

  for (const binding of skill.mcpBindings || []) {
    const issueCodes: SkillDependencyIssueCode[] = [];
    const server = serverById.get(binding.serverId);
    const addBindingIssue = (issue: SkillDependencyIssue) => {
      issues.push(issue);
      issueCodes.push(issue.code);
    };

    if (!server) {
      addBindingIssue({
        code: "mcp_server_missing",
        severity: "blocking",
        serverId: binding.serverId,
        toolName: binding.toolName,
        registeredName: binding.registeredName,
        message: `MCP Server「${binding.serverId}」不存在，请恢复 Server 配置或重新绑定工具`,
      });
      bindings.push({ ...binding, status: "unavailable", issueCodes });
      continue;
    }

    if (!server.enabled) {
      addBindingIssue({
        code: "mcp_server_disabled",
        severity: "blocking",
        serverId: server.id,
        serverState: server.status.state,
        toolName: binding.toolName,
        registeredName: binding.registeredName,
        message: `MCP Server「${server.name || server.id}」已停用，请先启用并启动`,
      });
      bindings.push({ ...binding, serverName: server.name, serverState: server.status.state, status: "unavailable", issueCodes });
      continue;
    }

    if (server.status.state !== "running") {
      const errorDetail = server.status.lastError ? `：${server.status.lastError}` : "";
      addBindingIssue({
        code: "mcp_server_not_running",
        severity: "blocking",
        serverId: server.id,
        serverState: server.status.state,
        toolName: binding.toolName,
        registeredName: binding.registeredName,
        message: `MCP Server「${server.name || server.id}」${serverStateLabel(server.status.state)}${errorDetail}`,
      });
      bindings.push({ ...binding, serverName: server.name, serverState: server.status.state, status: "unavailable", issueCodes });
      continue;
    }

    const currentTool = server.status.tools.find((tool) => tool.name === binding.toolName);
    if (!currentTool) {
      addBindingIssue({
        code: "mcp_tool_missing",
        severity: "blocking",
        serverId: server.id,
        serverState: server.status.state,
        toolName: binding.toolName,
        registeredName: binding.registeredName,
        message: `MCP Server「${server.name || server.id}」已不再提供工具「${binding.toolName}」，请重新绑定`,
      });
      bindings.push({ ...binding, serverName: server.name, serverState: server.status.state, status: "unavailable", issueCodes });
      continue;
    }

    if (currentTool.permission === "disabled") {
      addBindingIssue({
        code: "mcp_tool_disabled",
        severity: "blocking",
        serverId: server.id,
        serverState: server.status.state,
        toolName: binding.toolName,
        registeredName: binding.registeredName,
        message: `MCP 工具「${binding.toolName}」已禁用，请调整工具权限`,
      });
    } else if (currentTool.registeredName !== binding.registeredName) {
      addBindingIssue({
        code: "mcp_registered_name_changed",
        severity: "blocking",
        serverId: server.id,
        serverState: server.status.state,
        toolName: binding.toolName,
        registeredName: binding.registeredName,
        suggestedRegisteredName: currentTool.registeredName,
        message: `MCP 工具「${binding.toolName}」的注册名已变为「${currentTool.registeredName}」，请重新绑定`,
      });
    } else if (!toolNames.has(binding.registeredName)) {
      addBindingIssue({
        code: "mcp_tool_unregistered",
        severity: "blocking",
        serverId: server.id,
        serverState: server.status.state,
        toolName: binding.toolName,
        registeredName: binding.registeredName,
        message: `MCP 工具「${binding.registeredName}」尚未注册到 Agent，请重启 Server 后重试`,
      });
    }

    if (hasToolWhitelist && !allowedTools.has(binding.registeredName)) {
      addBindingIssue({
        code: "mcp_tool_not_allowed",
        severity: "blocking",
        serverId: server.id,
        serverState: server.status.state,
        toolName: binding.toolName,
        registeredName: binding.registeredName,
        message: `MCP 工具「${binding.registeredName}」未包含在 Skill 工具白名单中`,
      });
    }

    bindings.push({
      ...binding,
      serverName: server.name,
      serverState: server.status.state,
      currentRegisteredName: currentTool.registeredName,
      permission: currentTool.permission,
      status: issueCodes.length === 0 ? "healthy" : "unavailable",
      issueCodes,
    });
  }

  const requiredTools = new Set(skill.requiredTools || []);

  for (const toolName of requiredTools) {
    if (hasToolWhitelist && !allowedTools.has(toolName)) {
      issues.push({
        code: "required_tool_not_allowed",
        severity: "blocking",
        toolName,
        registeredName: toolName,
        message: `必需工具「${toolName}」未包含在 Skill 工具白名单中`,
      });
    }
    if (!toolNames.has(toolName) && !bindingNames.has(toolName)) {
      issues.push({
        code: "required_tool_missing",
        severity: "blocking",
        toolName,
        registeredName: toolName,
        message: `必需工具「${toolName}」当前不可用`,
      });
    }
  }

  for (const toolName of allowedTools) {
    if (requiredTools.has(toolName) || bindingNames.has(toolName) || toolNames.has(toolName)) continue;
    issues.push({
      code: "optional_tool_missing",
      severity: "warning",
      toolName,
      registeredName: toolName,
      message: `可选工具「${toolName}」当前不可用，部分能力将受限`,
    });
  }

  const runnable = !issues.some((issue) => issue.severity === "blocking");
  return {
    status: runnable ? (issues.length > 0 ? "degraded" : "healthy") : "unavailable",
    runnable,
    checkedAt,
    issues,
    bindings,
  };
}

export function createSkillDependencySnapshot(): SkillDependencySnapshot {
  return {
    servers: listPublicMcpServers(),
    registeredToolNames: getAllTools().map((tool) => tool.name),
    checkedAt: new Date().toISOString(),
  };
}

export function getSkillDependencyHealth(
  skill: Skill,
  snapshot = createSkillDependencySnapshot()
): SkillDependencyHealth {
  return evaluateSkillDependencies(
    skill,
    snapshot.servers,
    snapshot.registeredToolNames,
    snapshot.checkedAt
  );
}

export class SkillDependencyError extends Error {
  readonly code = "SKILL_DEPENDENCY_UNAVAILABLE";

  constructor(readonly skill: Skill, readonly health: SkillDependencyHealth) {
    const details = health.issues
      .filter((issue) => issue.severity === "blocking")
      .slice(0, 3)
      .map((issue) => issue.message)
      .join("；");
    super(`Skill「${skill.name}」当前无法运行：${details || "依赖不可用"}。请修复工具或 MCP 依赖后重试。`);
    this.name = "SkillDependencyError";
  }
}

export function assertSkillDependencies(skill: Skill): SkillDependencyHealth {
  const health = getSkillDependencyHealth(skill);
  if (!health.runnable) throw new SkillDependencyError(skill, health);
  return health;
}
