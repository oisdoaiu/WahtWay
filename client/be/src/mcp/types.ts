export type McpToolPermission = "auto" | "confirm" | "disabled";

export interface McpServerConfig {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  cwd: string | null;
  env: Record<string, string>;
  enabled: boolean;
  autoStart: boolean;
  defaultToolPermission: McpToolPermission;
  toolPermissions: Record<string, McpToolPermission>;
  /** Read-only compatibility field for schema version 1 data. */
  requireApproval?: boolean;
  toolCallTimeoutMs: number;
  createdAt: string;
  updatedAt: string;
  schemaVersion: 2;
}

export interface McpToolSummary {
  name: string;
  registeredName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  permission?: McpToolPermission;
  overridden?: boolean;
}

export interface PendingMcpApproval {
  token: string;
  serverId: string;
  toolName: string;
  args: Record<string, unknown>;
  expiresAt: number;
}

export type McpRuntimeState = "stopped" | "starting" | "running" | "error";

export interface McpServerStatus {
  state: McpRuntimeState;
  tools: McpToolSummary[];
  startedAt: string | null;
  lastError: string | null;
}

export interface PublicMcpServer extends McpServerConfig {
  secretNames: string[];
  status: McpServerStatus;
}
