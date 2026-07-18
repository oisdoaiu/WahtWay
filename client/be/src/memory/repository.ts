import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { getMemoryDir } from "../runtime-data";

export type MemoryCategory = "preference" | "profile" | "project" | "instruction" | "other";

export interface MemoryItem {
  id: string;
  content: string;
  category: MemoryCategory;
  source: "manual" | "suggested";
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  enabled: boolean;
  sensitive: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  schemaVersion: 1;
}

const FILE_PATH = path.join(getMemoryDir(), "items.json");
const CATEGORIES = new Set<MemoryCategory>(["preference", "profile", "project", "instruction", "other"]);

function readItems(): MemoryItem[] {
  if (!fs.existsSync(FILE_PATH)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(FILE_PATH, "utf-8"));
    return Array.isArray(data?.items) ? data.items.filter((item: any) => item && typeof item.id === "string") : [];
  } catch {
    return [];
  }
}

function writeItems(items: MemoryItem[]): void {
  fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
  const temporary = `${FILE_PATH}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, items }, null, 2), "utf-8");
  fs.renameSync(temporary, FILE_PATH);
}

export function detectSensitiveMemory(content: string): boolean {
  const patterns = [
    /\b(?:sk|pk)-[a-zA-Z0-9_-]{12,}\b/,
    /\b(?:password|passwd|密码|口令)\s*[:=：]\s*\S+/i,
    /\b(?:token|api[_ -]?key|secret|私钥|密钥)\s*[:=：]\s*\S+/i,
    /\b\d{15,19}\b/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  ];
  return patterns.some((pattern) => pattern.test(content));
}

export function listMemoryItems(): MemoryItem[] {
  return readItems().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createMemoryItem(input: {
  content: string;
  category?: unknown;
  sourceConversationId?: unknown;
  sourceMessageId?: unknown;
}): MemoryItem {
  const content = input.content.trim().slice(0, 2000);
  if (!content) throw new Error("EMPTY_MEMORY");
  if (detectSensitiveMemory(content)) throw new Error("SENSITIVE_MEMORY_BLOCKED");
  const now = new Date().toISOString();
  const item: MemoryItem = {
    id: randomUUID(),
    content,
    category: CATEGORIES.has(input.category as MemoryCategory) ? input.category as MemoryCategory : "other",
    source: "manual",
    sourceConversationId: typeof input.sourceConversationId === "string" ? input.sourceConversationId : null,
    sourceMessageId: typeof input.sourceMessageId === "string" ? input.sourceMessageId : null,
    enabled: true,
    sensitive: false,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    schemaVersion: 1,
  };
  const items = readItems();
  items.push(item);
  writeItems(items);
  return item;
}

export function updateMemoryItem(id: string, patch: { content?: unknown; category?: unknown; enabled?: unknown }): MemoryItem | null {
  const items = readItems();
  const item = items.find((candidate) => candidate.id === id);
  if (!item) return null;
  if (typeof patch.content === "string") {
    const content = patch.content.trim().slice(0, 2000);
    if (!content) throw new Error("EMPTY_MEMORY");
    if (detectSensitiveMemory(content)) throw new Error("SENSITIVE_MEMORY_BLOCKED");
    item.content = content;
  }
  if (CATEGORIES.has(patch.category as MemoryCategory)) item.category = patch.category as MemoryCategory;
  if (typeof patch.enabled === "boolean") item.enabled = patch.enabled;
  item.updatedAt = new Date().toISOString();
  writeItems(items);
  return item;
}

export function deleteMemoryItem(id: string): boolean {
  const items = readItems();
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) return false;
  writeItems(next);
  return true;
}

export function selectMemoryItems(mode: "off" | "manual" | "all", selectedIds: string[], query: string): MemoryItem[] {
  if (mode === "off") return [];
  const enabled = readItems().filter((item) => item.enabled && !item.sensitive);
  let selected: MemoryItem[];
  if (mode === "manual") {
    const ids = new Set(selectedIds);
    selected = enabled.filter((item) => ids.has(item.id));
  } else {
    const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length >= 2);
    selected = enabled
      .map((item) => ({ item, score: terms.filter((term) => item.content.toLowerCase().includes(term)).length }))
      .sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt))
      .slice(0, 10)
      .map(({ item }) => item);
  }
  if (selected.length > 0) {
    const used = new Set(selected.map((item) => item.id));
    const now = new Date().toISOString();
    const items = readItems().map((item) => used.has(item.id) ? { ...item, lastUsedAt: now } : item);
    writeItems(items);
  }
  return selected.slice(0, 10);
}
