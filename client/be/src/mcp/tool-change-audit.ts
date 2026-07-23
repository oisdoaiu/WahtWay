import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { getMcpServersDir } from "../runtime-data";
import { McpToolPermission, McpToolSummary } from "./types";

const AUDIT_PATH = path.join(getMcpServersDir(), "tool-change-audit.json");
const MAX_EVENTS = 500;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export interface McpAuditedTool {
  name: string;
  registeredName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  permission: McpToolPermission;
}

export type McpToolChangedField = "description" | "inputSchema" | "permission" | "registeredName";

export interface McpModifiedTool {
  name: string;
  changedFields: McpToolChangedField[];
  before: McpAuditedTool;
  after: McpAuditedTool;
}

export interface McpToolChangeAuditEvent {
  id: string;
  serverId: string;
  revision: number;
  source: "list_changed" | "permission_change";
  createdAt: string;
  added: McpAuditedTool[];
  removed: McpAuditedTool[];
  modified: McpModifiedTool[];
}

interface AuditFile {
  schemaVersion: 1;
  events: McpToolChangeAuditEvent[];
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function auditedTool(tool: McpToolSummary): McpAuditedTool {
  return {
    name: tool.name,
    registeredName: tool.registeredName,
    description: tool.description,
    inputSchema: structuredClone(tool.inputSchema),
    permission: tool.permission || "confirm",
  };
}

function readFile(): AuditFile {
  if (!fs.existsSync(AUDIT_PATH)) return { schemaVersion: 1, events: [] };
  const stat = fs.statSync(AUDIT_PATH);
  if (stat.size > MAX_FILE_BYTES) throw new Error("MCP tool audit file exceeds the size limit");
  try {
    const value = JSON.parse(fs.readFileSync(AUDIT_PATH, "utf-8"));
    return value?.schemaVersion === 1 && Array.isArray(value.events)
      ? value as AuditFile
      : { schemaVersion: 1, events: [] };
  } catch {
    return { schemaVersion: 1, events: [] };
  }
}

function writeFile(value: AuditFile): void {
  fs.mkdirSync(path.dirname(AUDIT_PATH), { recursive: true });
  const body = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(body, "utf-8") > MAX_FILE_BYTES) {
    throw new Error("MCP tool audit file exceeds the size limit");
  }
  const temporary = `${AUDIT_PATH}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, body, { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(temporary, AUDIT_PATH);
}

export function buildToolChangeAuditEvent(
  serverId: string,
  revision: number,
  before: McpToolSummary[],
  after: McpToolSummary[],
  source: McpToolChangeAuditEvent["source"] = "list_changed"
): McpToolChangeAuditEvent | null {
  const previous = new Map(before.map((tool) => [tool.name, auditedTool(tool)]));
  const next = new Map(after.map((tool) => [tool.name, auditedTool(tool)]));
  const added: McpAuditedTool[] = [];
  const removed: McpAuditedTool[] = [];
  const modified: McpModifiedTool[] = [];

  for (const [name, tool] of next) {
    const oldTool = previous.get(name);
    if (!oldTool) {
      added.push(tool);
      continue;
    }
    const changedFields: McpToolChangedField[] = [];
    if (oldTool.description !== tool.description) changedFields.push("description");
    if (stableJson(oldTool.inputSchema) !== stableJson(tool.inputSchema)) changedFields.push("inputSchema");
    if (oldTool.permission !== tool.permission) changedFields.push("permission");
    if (oldTool.registeredName !== tool.registeredName) changedFields.push("registeredName");
    if (changedFields.length > 0) modified.push({ name, changedFields, before: oldTool, after: tool });
  }
  for (const [name, tool] of previous) {
    if (!next.has(name)) removed.push(tool);
  }
  if (added.length === 0 && removed.length === 0 && modified.length === 0) return null;
  const byName = (left: McpAuditedTool, right: McpAuditedTool) => left.name.localeCompare(right.name);
  added.sort(byName);
  removed.sort(byName);
  modified.sort((left, right) => left.name.localeCompare(right.name));
  return {
    id: randomUUID(), serverId, revision, source,
    createdAt: new Date().toISOString(), added, removed, modified,
  };
}

export function appendToolChangeAuditEvent(event: McpToolChangeAuditEvent): void {
  const file = readFile();
  file.events.push(structuredClone(event));
  file.events = file.events.slice(-MAX_EVENTS);
  writeFile(file);
}

export function listToolChangeAuditEvents(serverId: string, limit = 50): McpToolChangeAuditEvent[] {
  const normalizedLimit = Math.max(1, Math.min(100, Math.floor(limit) || 50));
  return readFile().events
    .filter((event) => event.serverId === serverId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, normalizedLimit)
    .map((event) => structuredClone(event));
}

export function nextToolChangeAuditRevision(serverId: string): number {
  const revisions = readFile().events
    .filter((event) => event.serverId === serverId)
    .map((event) => event.revision);
  return (revisions.length > 0 ? Math.max(...revisions) : 0) + 1;
}
