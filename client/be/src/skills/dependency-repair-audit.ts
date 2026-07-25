import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { getSkillDependencyRepairDir } from "../runtime-data";
import { McpSkillBinding } from "../types";

const AUDIT_PATH = path.join(getSkillDependencyRepairDir(), "audit.json");
const MAX_EVENTS = 500;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export type SkillDependencyRepairChangedField =
  | "mcpBindings"
  | "allowedTools"
  | "requiredTools"
  | "systemPrompt";

export type SkillDependencyRepairPromptPolicy = "preserve" | "replace-exact";

export interface SkillDependencyRepairAuditEvent {
  id: string;
  skillId: string;
  createdAt: string;
  bindingIndex: number;
  beforeRevision: string;
  afterRevision: string;
  beforeBinding: McpSkillBinding;
  afterBinding: McpSkillBinding;
  changedFields: SkillDependencyRepairChangedField[];
  promptPolicy: SkillDependencyRepairPromptPolicy;
  promptReplacementCount: number;
  warnings: string[];
}

export type CreateSkillDependencyRepairAuditEventInput = Omit<
  SkillDependencyRepairAuditEvent,
  "id" | "createdAt"
>;

interface AuditFile {
  schemaVersion: 1;
  events: SkillDependencyRepairAuditEvent[];
}

const CHANGED_FIELDS = new Set<SkillDependencyRepairChangedField>([
  "mcpBindings",
  "allowedTools",
  "requiredTools",
  "systemPrompt",
]);

function copyBinding(binding: McpSkillBinding): McpSkillBinding {
  if (!binding || typeof binding !== "object") throw new Error("Skill dependency repair audit binding is invalid");
  const serverId = typeof binding.serverId === "string" ? binding.serverId : "";
  const toolName = typeof binding.toolName === "string" ? binding.toolName : "";
  const registeredName = typeof binding.registeredName === "string" ? binding.registeredName : "";
  if (!serverId || !toolName || !registeredName) {
    throw new Error("Skill dependency repair audit binding is incomplete");
  }
  return { serverId, toolName, registeredName };
}

function sanitizeEvent(event: SkillDependencyRepairAuditEvent): SkillDependencyRepairAuditEvent {
  if (!event || typeof event !== "object") throw new Error("Skill dependency repair audit event is invalid");
  if (typeof event.id !== "string" || !event.id) throw new Error("Skill dependency repair audit event id is invalid");
  if (typeof event.skillId !== "string" || !event.skillId) throw new Error("Skill dependency repair audit skill id is invalid");
  if (typeof event.createdAt !== "string" || !event.createdAt) throw new Error("Skill dependency repair audit timestamp is invalid");
  if (!Number.isInteger(event.bindingIndex) || event.bindingIndex < 0) {
    throw new Error("Skill dependency repair audit binding index is invalid");
  }
  if (typeof event.beforeRevision !== "string" || !event.beforeRevision) {
    throw new Error("Skill dependency repair audit before revision is invalid");
  }
  if (typeof event.afterRevision !== "string" || !event.afterRevision) {
    throw new Error("Skill dependency repair audit after revision is invalid");
  }
  if (event.promptPolicy !== "preserve" && event.promptPolicy !== "replace-exact") {
    throw new Error("Skill dependency repair audit prompt policy is invalid");
  }
  if (!Number.isInteger(event.promptReplacementCount) || event.promptReplacementCount < 0) {
    throw new Error("Skill dependency repair audit prompt replacement count is invalid");
  }

  const changedFields = Array.isArray(event.changedFields)
    ? event.changedFields.filter((field): field is SkillDependencyRepairChangedField => CHANGED_FIELDS.has(field))
    : [];
  const warnings = Array.isArray(event.warnings)
    ? event.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];

  return {
    id: event.id,
    skillId: event.skillId,
    createdAt: event.createdAt,
    bindingIndex: event.bindingIndex,
    beforeRevision: event.beforeRevision,
    afterRevision: event.afterRevision,
    beforeBinding: copyBinding(event.beforeBinding),
    afterBinding: copyBinding(event.afterBinding),
    changedFields: [...new Set(changedFields)],
    promptPolicy: event.promptPolicy,
    promptReplacementCount: event.promptReplacementCount,
    warnings: [...warnings],
  };
}

function readFile(): AuditFile {
  if (!fs.existsSync(AUDIT_PATH)) return { schemaVersion: 1, events: [] };
  const stat = fs.statSync(AUDIT_PATH);
  if (stat.size > MAX_FILE_BYTES) throw new Error("Skill dependency repair audit file exceeds the size limit");
  try {
    const value = JSON.parse(fs.readFileSync(AUDIT_PATH, "utf-8"));
    if (value?.schemaVersion !== 1 || !Array.isArray(value.events)) {
      return { schemaVersion: 1, events: [] };
    }
    return {
      schemaVersion: 1,
      events: value.events.flatMap((event: SkillDependencyRepairAuditEvent) => {
        try {
          return [sanitizeEvent(event)];
        } catch {
          return [];
        }
      }),
    };
  } catch (error) {
    if (error instanceof SyntaxError) return { schemaVersion: 1, events: [] };
    throw error;
  }
}

function serializedWithinLimit(file: AuditFile): string {
  file.events = file.events.slice(-MAX_EVENTS);
  let body = JSON.stringify(file, null, 2);
  while (Buffer.byteLength(body, "utf-8") > MAX_FILE_BYTES && file.events.length > 1) {
    file.events.shift();
    body = JSON.stringify(file, null, 2);
  }
  if (Buffer.byteLength(body, "utf-8") > MAX_FILE_BYTES) {
    throw new Error("Skill dependency repair audit file exceeds the size limit");
  }
  return body;
}

function writeFile(file: AuditFile): void {
  fs.mkdirSync(path.dirname(AUDIT_PATH), { recursive: true, mode: 0o700 });
  const body = serializedWithinLimit(file);
  const temporary = `${AUDIT_PATH}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, body, { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(temporary, AUDIT_PATH);
    fs.chmodSync(AUDIT_PATH, 0o600);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function createSkillDependencyRepairAuditEvent(
  input: CreateSkillDependencyRepairAuditEventInput
): SkillDependencyRepairAuditEvent {
  return sanitizeEvent({
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  });
}

export function appendSkillDependencyRepairAuditEvent(event: SkillDependencyRepairAuditEvent): void {
  const file = readFile();
  file.events.push(sanitizeEvent(event));
  writeFile(file);
}

export function listSkillDependencyRepairAuditEvents(
  skillId?: string,
  limit = 50
): SkillDependencyRepairAuditEvent[] {
  const normalizedLimit = Math.max(1, Math.min(100, Math.floor(limit) || 50));
  return readFile().events
    .filter((event) => !skillId || event.skillId === skillId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, normalizedLimit)
    .map((event) => structuredClone(event));
}
