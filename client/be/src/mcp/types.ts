export type McpToolPermission = "auto" | "confirm" | "disabled";
export type McpToolRisk = "read" | "write" | "destructive";
export type McpToolRiskSource = "local" | "server" | "server-hint" | "default";

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpToolSafetyOverride {
  risk?: McpToolRisk;
  idempotent?: boolean;
}

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
  toolSafetyOverrides: Record<string, McpToolSafetyOverride>;
  /** Read-only compatibility field for schema version 1 data. */
  requireApproval?: boolean;
  toolCallTimeoutMs: number;
  createdAt: string;
  updatedAt: string;
  schemaVersion: 3;
}

export interface McpToolSummary {
  name: string;
  registeredName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  permission?: McpToolPermission;
  overridden?: boolean;
  annotations: McpToolAnnotations;
  safetyOverride?: McpToolSafetyOverride;
  risk: McpToolRisk;
  riskSource: McpToolRiskSource;
  idempotent: boolean;
}

export interface PendingMcpApproval {
  token: string;
  serverId: string;
  toolName: string;
  args: Record<string, unknown>;
  expiresAt: number;
}

export type McpRuntimeState = "stopped" | "starting" | "running" | "reconnecting" | "error";

export interface McpServerStatus {
  state: McpRuntimeState;
  tools: McpToolSummary[];
  startedAt: string | null;
  lastError: string | null;
  lastHealthCheckAt: string | null;
  lastDisconnectedAt: string | null;
  consecutiveFailures: number;
  reconnectAttempt: number;
  nextReconnectAt: string | null;
  toolListRevision: number;
  lastToolListChangedAt: string | null;
  lastToolListError: string | null;
}

export interface PublicMcpServer extends McpServerConfig {
  secretNames: string[];
  status: McpServerStatus;
}
