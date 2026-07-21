export type AgentRunStatus =
  | "waiting_approval"
  | "resuming"
  | "completed"
  | "failed"
  | "expired";

export type ApprovalKind = "file" | "command" | "external" | "mcp";

export interface SerializedToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface PendingApproval {
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  kind: ApprovalKind;
  reason: string;
  target?: string;
}

export interface AgentRunCheckpoint {
  id: string;
  status: AgentRunStatus;
  conversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  traceId: string;
  model?: string;
  systemPrompt: string;
  messages: unknown[];
  allowedTools?: string[];
  workspace?: string;
  round: number;
  totalRoundTokens: number;
  toolCallCount: number;
  startedAt: string;
  currentBatch: {
    calls: SerializedToolCall[];
    nextIndex: number;
  };
  pendingApproval: PendingApproval;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface CreateAgentRunCheckpoint
  extends Omit<AgentRunCheckpoint, "id" | "status" | "createdAt" | "updatedAt" | "expiresAt"> {
  expiresAt?: string;
}
