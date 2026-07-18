import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { getConversationsDir } from "../runtime-data";

export type MemoryMode = "off" | "manual" | "all";

export interface StoredChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  status: "streaming" | "completed" | "aborted" | "error";
  skillName?: string;
  skillId?: string;
  skillVersion?: number;
  skillRunId?: string;
  stats?: unknown;
  memoryIds?: string[];
}

export interface StoredConversation {
  id: string;
  title: string;
  messages: StoredChatMessage[];
  createdAt: string;
  updatedAt: string;
  summary: string | null;
  summaryThroughMessageId: string | null;
  summaryUpdatedAt: string | null;
  memoryMode: MemoryMode;
  schemaVersion: 1;
}

const DATA_DIR = getConversationsDir();
const VALID_ID = /^[a-zA-Z0-9-]{1,80}$/;

function normalizeTime(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  return fallback;
}

function normalizeMessage(raw: any, conversationId: string, index: number): StoredChatMessage | null {
  if (!raw || (raw.role !== "user" && raw.role !== "assistant") || typeof raw.content !== "string") return null;
  const now = new Date().toISOString();
  return {
    ...raw,
    id: typeof raw.id === "string" && raw.id ? raw.id : `${conversationId}-${index}`,
    conversationId,
    role: raw.role,
    content: raw.content,
    createdAt: normalizeTime(raw.createdAt, now),
    status: raw.status === "streaming" || raw.status === "aborted" || raw.status === "error"
      ? raw.status
      : "completed",
  };
}

function normalizeConversation(raw: any, id: string): StoredConversation {
  const now = new Date().toISOString();
  const messages = Array.isArray(raw?.messages)
    ? raw.messages.map((message: any, index: number) => normalizeMessage(message, id, index)).filter(Boolean)
    : [];
  return {
    id,
    title: typeof raw?.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 80) : "新对话",
    messages: messages as StoredChatMessage[],
    createdAt: normalizeTime(raw?.createdAt, now),
    updatedAt: normalizeTime(raw?.updatedAt, now),
    summary: typeof raw?.summary === "string" && raw.summary.trim() ? raw.summary.trim() : null,
    summaryThroughMessageId: typeof raw?.summaryThroughMessageId === "string" ? raw.summaryThroughMessageId : null,
    summaryUpdatedAt: typeof raw?.summaryUpdatedAt === "string" ? raw.summaryUpdatedAt : null,
    memoryMode: raw?.memoryMode === "manual" || raw?.memoryMode === "all" ? raw.memoryMode : "off",
    schemaVersion: 1,
  };
}

export function isValidConversationId(id: unknown): id is string {
  return typeof id === "string" && VALID_ID.test(id);
}

function conversationPath(id: string): string {
  if (!isValidConversationId(id)) throw new Error("INVALID_CONVERSATION_ID");
  const resolved = path.resolve(DATA_DIR, `${id}.json`);
  const root = path.resolve(DATA_DIR) + path.sep;
  if (!resolved.startsWith(root)) throw new Error("INVALID_CONVERSATION_PATH");
  return resolved;
}

function atomicWrite(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(temporary, filePath);
}

export function listConversations(): Omit<StoredConversation, "messages">[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readConversation(name.slice(0, -5)))
    .filter((item): item is StoredConversation => !!item)
    .map(({ messages: _messages, ...conversation }) => conversation)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function readConversation(id: string): StoredConversation | null {
  if (!isValidConversationId(id)) return null;
  const filePath = conversationPath(id);
  if (!fs.existsSync(filePath)) return null;
  try {
    return normalizeConversation(JSON.parse(fs.readFileSync(filePath, "utf-8")), id);
  } catch {
    return null;
  }
}

export function createConversation(input: { title?: unknown; memoryMode?: unknown } = {}): StoredConversation {
  const now = new Date().toISOString();
  const id = randomUUID();
  const conversation: StoredConversation = {
    id,
    title: typeof input.title === "string" && input.title.trim() ? input.title.trim().slice(0, 80) : "新对话",
    messages: [],
    createdAt: now,
    updatedAt: now,
    summary: null,
    summaryThroughMessageId: null,
    summaryUpdatedAt: null,
    memoryMode: input.memoryMode === "manual" || input.memoryMode === "all" ? input.memoryMode : "off",
    schemaVersion: 1,
  };
  atomicWrite(conversationPath(id), conversation);
  return conversation;
}

export function saveConversation(conversation: StoredConversation): StoredConversation {
  const normalized = normalizeConversation({ ...conversation, updatedAt: new Date().toISOString() }, conversation.id);
  atomicWrite(conversationPath(conversation.id), normalized);
  return normalized;
}

export function updateConversation(
  id: string,
  patch: Partial<Pick<StoredConversation, "title" | "memoryMode" | "summary" | "summaryThroughMessageId" | "summaryUpdatedAt">>
): StoredConversation | null {
  const conversation = readConversation(id);
  if (!conversation) return null;
  if (typeof patch.title === "string" && patch.title.trim()) conversation.title = patch.title.trim().slice(0, 80);
  if (patch.memoryMode === "off" || patch.memoryMode === "manual" || patch.memoryMode === "all") {
    conversation.memoryMode = patch.memoryMode;
  }
  if (patch.summary === null || typeof patch.summary === "string") conversation.summary = patch.summary;
  if (patch.summaryThroughMessageId === null || typeof patch.summaryThroughMessageId === "string") {
    conversation.summaryThroughMessageId = patch.summaryThroughMessageId;
  }
  if (patch.summaryUpdatedAt === null || typeof patch.summaryUpdatedAt === "string") {
    conversation.summaryUpdatedAt = patch.summaryUpdatedAt;
  }
  return saveConversation(conversation);
}

export function appendMessage(id: string, message: Omit<StoredChatMessage, "conversationId">): StoredChatMessage | null {
  const conversation = readConversation(id);
  if (!conversation) return null;
  const existing = conversation.messages.find((item) => item.id === message.id);
  if (existing) return existing;
  const stored = { ...message, conversationId: id };
  conversation.messages.push(stored);
  saveConversation(conversation);
  return stored;
}

export function patchMessage(
  conversationId: string,
  messageId: string,
  patch: Partial<Omit<StoredChatMessage, "id" | "conversationId" | "role">>
): StoredChatMessage | null {
  const conversation = readConversation(conversationId);
  if (!conversation) return null;
  const message = conversation.messages.find((item) => item.id === messageId);
  if (!message) return null;
  Object.assign(message, patch);
  saveConversation(conversation);
  return message;
}

export function deleteConversation(id: string): boolean {
  if (!isValidConversationId(id)) return false;
  const filePath = conversationPath(id);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}
