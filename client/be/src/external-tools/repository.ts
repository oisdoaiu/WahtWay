import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { getExternalToolsDir } from "../runtime-data";
import { ExternalToolConfig, ExternalToolMethod, ExternalToolPermission, PublicExternalTool } from "./types";

const CONFIG_PATH = path.join(getExternalToolsDir(), "tools.json");
const SECRETS_PATH = path.join(getExternalToolsDir(), "secrets.json");
const VALID_ID = /^[a-z][a-z0-9-]{1,62}$/;
const METHODS = new Set<ExternalToolMethod>(["GET", "POST", "PUT", "PATCH"]);
const PERMISSIONS = new Set<ExternalToolPermission>(["read", "write"]);

function atomicWrite(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function readJson(filePath: string, fallback: any): any {
  if (!fs.existsSync(filePath)) return fallback;
  try { return JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { return fallback; }
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .slice(0, 30));
}

function validateUrl(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("URL_REQUIRED");
  const value = raw.trim();
  const authority = value.match(/^https:\/\/([^/]+)/i)?.[1] || "";
  if (authority.includes("{{") || authority.includes("${")) throw new Error("DYNAMIC_HOST_FORBIDDEN");
  const candidate = value
    .replace(/\{\{[a-zA-Z0-9_-]+\}\}/g, "placeholder")
    .replace(/\$\{[A-Z][A-Z0-9_]+\}/g, "secret");
  const url = new URL(candidate);
  if (url.protocol !== "https:") throw new Error("HTTPS_REQUIRED");
  if (url.username || url.password) throw new Error("URL_CREDENTIALS_FORBIDDEN");
  return value;
}

function normalize(input: any, existing?: ExternalToolConfig): ExternalToolConfig {
  const now = new Date().toISOString();
  const id = String(input?.id || existing?.id || "").trim();
  if (!VALID_ID.test(id)) throw new Error("INVALID_TOOL_ID");
  const name = String(input?.name ?? existing?.name ?? "").trim().slice(0, 80);
  const description = String(input?.description ?? existing?.description ?? "").trim().slice(0, 1000);
  if (!name || !description) throw new Error("NAME_DESCRIPTION_REQUIRED");
  const method = String(input?.method ?? existing?.method ?? "GET").toUpperCase() as ExternalToolMethod;
  const permission = String(input?.permission ?? existing?.permission ?? "read") as ExternalToolPermission;
  if (!METHODS.has(method) || !PERMISSIONS.has(permission)) throw new Error("INVALID_TOOL_OPTION");
  const parameters = input?.parameters ?? existing?.parameters ?? { type: "object", properties: {} };
  if (!parameters || parameters.type !== "object") throw new Error("INVALID_PARAMETERS");
  return {
    id,
    name,
    description,
    method,
    url: validateUrl(input?.url ?? existing?.url),
    headers: stringRecord(input?.headers ?? existing?.headers),
    parameters,
    query: stringRecord(input?.query ?? existing?.query),
    body: input?.body !== undefined ? input.body : existing?.body ?? null,
    responseDataPath: String(input?.responseDataPath ?? existing?.responseDataPath ?? "").trim().slice(0, 200),
    permission,
    enabled: typeof input?.enabled === "boolean" ? input.enabled : existing?.enabled ?? true,
    timeoutMs: Math.max(1000, Math.min(30000, Number(input?.timeoutMs ?? existing?.timeoutMs ?? 10000))),
    maxResponseBytes: Math.max(1024, Math.min(1024 * 1024, Number(input?.maxResponseBytes ?? existing?.maxResponseBytes ?? 65536))),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    schemaVersion: 1,
  };
}

export function listExternalTools(): ExternalToolConfig[] {
  const data = readJson(CONFIG_PATH, { tools: [] });
  return Array.isArray(data.tools) ? data.tools : [];
}

export function getExternalTool(id: string): ExternalToolConfig | null {
  return listExternalTools().find((tool) => tool.id === id) || null;
}

export function saveExternalTool(input: unknown): ExternalToolConfig {
  const tools = listExternalTools();
  const raw = input as any;
  const existing = tools.find((tool) => tool.id === raw?.id);
  const tool = normalize(raw, existing);
  const next = existing ? tools.map((item) => item.id === tool.id ? tool : item) : [...tools, tool];
  atomicWrite(CONFIG_PATH, { schemaVersion: 1, tools: next });
  return tool;
}

export function deleteExternalTool(id: string): boolean {
  const tools = listExternalTools();
  const next = tools.filter((tool) => tool.id !== id);
  if (next.length === tools.length) return false;
  atomicWrite(CONFIG_PATH, { schemaVersion: 1, tools: next });
  const secrets = readSecrets();
  delete secrets[id];
  atomicWrite(SECRETS_PATH, secrets);
  return true;
}

function readSecrets(): Record<string, Record<string, string>> {
  const data = readJson(SECRETS_PATH, {});
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

export function getToolSecrets(id: string): Record<string, string> {
  return { ...(readSecrets()[id] || {}) };
}

export function setToolSecret(id: string, name: string, value: string): void {
  if (!getExternalTool(id)) throw new Error("TOOL_NOT_FOUND");
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(name)) throw new Error("INVALID_SECRET_NAME");
  if (!value.trim()) throw new Error("EMPTY_SECRET");
  const secrets = readSecrets();
  secrets[id] = { ...(secrets[id] || {}), [name]: value };
  atomicWrite(SECRETS_PATH, secrets);
}

export function deleteToolSecret(id: string, name: string): boolean {
  const secrets = readSecrets();
  if (!secrets[id] || !(name in secrets[id])) return false;
  delete secrets[id][name];
  atomicWrite(SECRETS_PATH, secrets);
  return true;
}

export function toPublicTool(tool: ExternalToolConfig): PublicExternalTool {
  return { ...tool, secretNames: Object.keys(getToolSecrets(tool.id)).sort() };
}
