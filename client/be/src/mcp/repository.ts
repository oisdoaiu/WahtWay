import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { getMcpServersDir } from "../runtime-data";
import { McpServerConfig, McpToolPermission } from "./types";

const CONFIG_PATH = path.join(getMcpServersDir(), "servers.json");
const SECRETS_PATH = path.join(getMcpServersDir(), "secrets.json");
const VALID_ID = /^[a-z][a-z0-9-]{1,62}$/;
const VALID_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const TOOL_PERMISSIONS = new Set<McpToolPermission>(["auto", "confirm", "disabled"]);

function atomicWrite(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function readJson(filePath: string, fallback: any): any {
  if (!fs.existsSync(filePath)) return fallback;
  try { return JSON.parse(fs.readFileSync(filePath, "utf-8")); }
  catch { return fallback; }
}

function normalizeString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field.toUpperCase()}_REQUIRED`);
  const result = value.trim();
  if (result.length > maxLength || result.includes("\0") || /[\r\n]/.test(result)) {
    throw new Error(`INVALID_${field.toUpperCase()}`);
  }
  return result;
}

function normalizeArgs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  if (value.length > 100) throw new Error("TOO_MANY_ARGS");
  return value.map((item) => {
    if (typeof item !== "string" || item.length > 4000 || item.includes("\0")) throw new Error("INVALID_ARGS");
    return item;
  });
}

function normalizeEnv(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 100) throw new Error("TOO_MANY_ENV_VARS");
  const env: Record<string, string> = {};
  for (const [name, raw] of entries) {
    if (!VALID_ENV_NAME.test(name) || typeof raw !== "string" || raw.length > 8000 || raw.includes("\0")) {
      throw new Error("INVALID_ENV");
    }
    env[name] = raw;
  }
  return env;
}

function normalizePermission(value: unknown, fallback: McpToolPermission): McpToolPermission {
  if (value === undefined || value === null || value === "") return fallback;
  if (!TOOL_PERMISSIONS.has(value as McpToolPermission)) throw new Error("INVALID_TOOL_PERMISSION");
  return value as McpToolPermission;
}

function normalizeToolPermissions(value: unknown): Record<string, McpToolPermission> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 500) throw new Error("TOO_MANY_TOOL_PERMISSIONS");
  const permissions: Record<string, McpToolPermission> = {};
  for (const [toolName, permission] of entries) {
    if (!toolName || toolName.length > 256 || toolName.includes("\0")) throw new Error("INVALID_TOOL_NAME");
    permissions[toolName] = normalizePermission(permission, "confirm");
  }
  return permissions;
}

function migrateStoredServer(raw: any): McpServerConfig {
  const legacyDefault: McpToolPermission = raw?.requireApproval === false ? "auto" : "confirm";
  return {
    ...raw,
    defaultToolPermission: TOOL_PERMISSIONS.has(raw?.defaultToolPermission)
      ? raw.defaultToolPermission
      : legacyDefault,
    toolPermissions: normalizeToolPermissions(raw?.toolPermissions),
    schemaVersion: 2,
  } as McpServerConfig;
}

function normalize(input: any, existing?: McpServerConfig): McpServerConfig {
  const now = new Date().toISOString();
  const id = String(input?.id || existing?.id || "").trim();
  if (!VALID_ID.test(id)) throw new Error("INVALID_SERVER_ID");
  const cwdValue = input?.cwd !== undefined ? input.cwd : existing?.cwd;
  const cwd = cwdValue === null || cwdValue === undefined || cwdValue === ""
    ? null
    : normalizeString(cwdValue, "cwd", 1000);
  return {
    id,
    name: normalizeString(input?.name ?? existing?.name, "name", 80),
    description: normalizeString(input?.description ?? existing?.description, "description", 1000),
    command: normalizeString(input?.command ?? existing?.command, "command", 1000),
    args: normalizeArgs(input?.args ?? existing?.args),
    cwd,
    env: normalizeEnv(input?.env ?? existing?.env),
    enabled: typeof input?.enabled === "boolean" ? input.enabled : existing?.enabled ?? true,
    autoStart: typeof input?.autoStart === "boolean" ? input.autoStart : existing?.autoStart ?? false,
    defaultToolPermission: normalizePermission(
      input?.defaultToolPermission,
      existing?.defaultToolPermission || (input?.requireApproval === false ? "auto" : "confirm")
    ),
    toolPermissions: normalizeToolPermissions(input?.toolPermissions ?? existing?.toolPermissions),
    toolCallTimeoutMs: Math.max(1000, Math.min(5 * 60 * 1000,
      Number(input?.toolCallTimeoutMs ?? existing?.toolCallTimeoutMs ?? 60000))),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    schemaVersion: 2,
  };
}

export function listMcpServers(): McpServerConfig[] {
  const data = readJson(CONFIG_PATH, { servers: [] });
  return Array.isArray(data.servers) ? data.servers.map(migrateStoredServer) : [];
}

export function getMcpServer(id: string): McpServerConfig | null {
  return listMcpServers().find((server) => server.id === id) || null;
}

export function saveMcpServer(input: unknown): McpServerConfig {
  const raw = input as any;
  const servers = listMcpServers();
  const existing = servers.find((server) => server.id === raw?.id);
  const server = normalize(raw, existing);
  const next = existing
    ? servers.map((item) => item.id === server.id ? server : item)
    : [...servers, server];
  atomicWrite(CONFIG_PATH, { schemaVersion: 1, servers: next });
  return server;
}

export function deleteMcpServer(id: string): boolean {
  const servers = listMcpServers();
  const next = servers.filter((server) => server.id !== id);
  if (next.length === servers.length) return false;
  atomicWrite(CONFIG_PATH, { schemaVersion: 1, servers: next });
  const secrets = readMcpSecrets();
  delete secrets[id];
  atomicWrite(SECRETS_PATH, secrets);
  return true;
}

function readMcpSecrets(): Record<string, Record<string, string>> {
  const data = readJson(SECRETS_PATH, {});
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

export function getMcpSecrets(id: string): Record<string, string> {
  return { ...(readMcpSecrets()[id] || {}) };
}

export function setMcpSecret(id: string, name: string, value: string): void {
  if (!getMcpServer(id)) throw new Error("SERVER_NOT_FOUND");
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(name)) throw new Error("INVALID_SECRET_NAME");
  if (!value.trim() || value.length > 16000 || value.includes("\0")) throw new Error("INVALID_SECRET_VALUE");
  const secrets = readMcpSecrets();
  secrets[id] = { ...(secrets[id] || {}), [name]: value };
  atomicWrite(SECRETS_PATH, secrets);
}

export function deleteMcpSecret(id: string, name: string): boolean {
  const secrets = readMcpSecrets();
  if (!secrets[id] || !(name in secrets[id])) return false;
  delete secrets[id][name];
  atomicWrite(SECRETS_PATH, secrets);
  return true;
}

export function listMcpSecretNames(id: string): string[] {
  return Object.keys(getMcpSecrets(id)).sort();
}
