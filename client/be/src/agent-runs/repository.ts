import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getAgentRunsDir } from "../runtime-data";
import { AgentRunCheckpoint, CreateAgentRunCheckpoint } from "./types";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CHECKPOINT_BYTES = 2 * 1024 * 1024;

export class AgentRunNotFoundError extends Error {}
export class AgentRunConflictError extends Error {}
export class AgentRunExpiredError extends Error {}
export class AgentRunConversationMismatchError extends Error {}

function checkpointPath(id: string): string {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new AgentRunNotFoundError("Agent run not found");
  return path.join(getAgentRunsDir(), `${id}.json`);
}

function writeAtomic(checkpoint: AgentRunCheckpoint): void {
  const filePath = checkpointPath(checkpoint.id);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = JSON.stringify(checkpoint, null, 2);
  if (Buffer.byteLength(body, "utf-8") > MAX_CHECKPOINT_BYTES) {
    throw new Error("Agent run checkpoint exceeds the size limit");
  }
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, body, { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function isCheckpoint(value: unknown): value is AgentRunCheckpoint {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<AgentRunCheckpoint>;
  return typeof item.id === "string"
    && typeof item.status === "string"
    && typeof item.traceId === "string"
    && typeof item.systemPrompt === "string"
    && Array.isArray(item.messages)
    && !!item.currentBatch
    && !!item.pendingApproval
    && typeof item.expiresAt === "string";
}

function read(id: string): AgentRunCheckpoint | null {
  const filePath = checkpointPath(id);
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_CHECKPOINT_BYTES) throw new Error("Agent run checkpoint exceeds the size limit");
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  if (!isCheckpoint(parsed) || parsed.id !== id) throw new Error("Invalid agent run checkpoint");
  return parsed;
}

function expireIfNeeded(checkpoint: AgentRunCheckpoint): AgentRunCheckpoint {
  if (checkpoint.status !== "waiting_approval" || Date.parse(checkpoint.expiresAt) > Date.now()) {
    return checkpoint;
  }
  const expired = { ...checkpoint, status: "expired" as const, updatedAt: new Date().toISOString() };
  writeAtomic(expired);
  return expired;
}

export function createAgentRunCheckpoint(input: CreateAgentRunCheckpoint): AgentRunCheckpoint {
  const now = new Date();
  const checkpoint: AgentRunCheckpoint = {
    ...input,
    id: randomUUID(),
    status: "waiting_approval",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: input.expiresAt || new Date(now.getTime() + DEFAULT_TTL_MS).toISOString(),
  };
  writeAtomic(checkpoint);
  return checkpoint;
}

export function getAgentRunCheckpoint(id: string): AgentRunCheckpoint | null {
  const checkpoint = read(id);
  return checkpoint ? expireIfNeeded(checkpoint) : null;
}

export function listPendingAgentRuns(conversationId: string): AgentRunCheckpoint[] {
  const directory = getAgentRunsDir();
  if (!fs.existsSync(directory)) return [];

  const checkpoints: AgentRunCheckpoint[] = [];
  for (const entry of fs.readdirSync(directory)) {
    if (!entry.endsWith(".json")) continue;
    try {
      const checkpoint = getAgentRunCheckpoint(entry.slice(0, -5));
      if (checkpoint?.status === "waiting_approval" && checkpoint.conversationId === conversationId) {
        checkpoints.push(checkpoint);
      }
    } catch {
      // A damaged checkpoint must not prevent other conversations from loading.
    }
  }
  return checkpoints.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function claimAgentRun(id: string, conversationId?: string): AgentRunCheckpoint {
  const checkpoint = getAgentRunCheckpoint(id);
  if (!checkpoint) throw new AgentRunNotFoundError("Agent run not found");
  if (checkpoint.status === "expired") throw new AgentRunExpiredError("Agent run has expired");
  if (checkpoint.conversationId && checkpoint.conversationId !== conversationId) {
    throw new AgentRunConversationMismatchError("Agent run belongs to another conversation");
  }
  if (checkpoint.status !== "waiting_approval") {
    throw new AgentRunConflictError("Agent run is not waiting for approval");
  }

  const claimed: AgentRunCheckpoint = {
    ...checkpoint,
    status: "resuming",
    updatedAt: new Date().toISOString(),
  };
  writeAtomic(claimed);
  return claimed;
}

export function saveAgentRunCheckpoint(checkpoint: AgentRunCheckpoint): AgentRunCheckpoint {
  const updated = { ...checkpoint, updatedAt: new Date().toISOString() };
  writeAtomic(updated);
  return updated;
}
