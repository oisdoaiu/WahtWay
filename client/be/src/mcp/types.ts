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
  toolCallTimeoutMs: number;
  createdAt: string;
  updatedAt: string;
  schemaVersion: 1;
}

export interface McpToolSummary {
  name: string;
  registeredName: string;
  description: string;
  inputSchema: Record<string, unknown>;
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
