import { promises as dns } from "dns";
import { randomUUID } from "crypto";
import { isIP } from "net";
import { ExternalToolConfig } from "./types";
import { getToolSecrets } from "./repository";

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || a >= 224;
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) return isPrivateIpv4(address);
  const value = address.toLowerCase();
  return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") ||
    value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb") ||
    value.startsWith("::ffff:127.") || value.startsWith("::ffff:10.") || value.startsWith("::ffff:192.168.");
}

async function assertPublicHttps(url: URL): Promise<void> {
  if (url.protocol !== "https:") throw new Error("仅允许 HTTPS 外部工具");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("禁止访问本机或局域网地址");
  }
  const addresses = isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new Error("目标域名解析到了私有或受限 IP");
  }
}

function validateArgs(tool: ExternalToolConfig, args: Record<string, unknown>): void {
  const properties = tool.parameters.properties || {};
  for (const required of tool.parameters.required || []) {
    if (args[required] === undefined || args[required] === null || args[required] === "") {
      throw new Error(`缺少必填参数: ${required}`);
    }
  }
  for (const [key, value] of Object.entries(args)) {
    const schema = properties[key];
    if (!schema) continue;
    if (schema.type === "string" && typeof value !== "string") throw new Error(`参数 ${key} 必须是字符串`);
    if (schema.type === "number" && typeof value !== "number") throw new Error(`参数 ${key} 必须是数字`);
    if (schema.type === "boolean" && typeof value !== "boolean") throw new Error(`参数 ${key} 必须是布尔值`);
    if (schema.enum && !schema.enum.includes(String(value))) throw new Error(`参数 ${key} 不在允许范围内`);
  }
}

function interpolate(value: unknown, args: Record<string, unknown>, secrets: Record<string, string>): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{([a-zA-Z0-9_-]+)\}\}/g, (_match, name) => String(args[name] ?? ""))
      .replace(/\$\{([A-Z][A-Z0-9_]+)\}/g, (_match, name) => {
        if (!(name in secrets)) throw new Error(`缺少 secret: ${name}`);
        return secrets[name];
      });
  }
  if (Array.isArray(value)) return value.map((item) => interpolate(item, args, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, interpolate(item, args, secrets)]));
  }
  return value;
}

function selectData(value: unknown, dataPath: string): unknown {
  if (!dataPath) return value;
  return dataPath.split(".").filter(Boolean).reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

async function readLimitedResponse(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) throw new Error(`外部 API 响应超过限制 (${maxBytes} bytes)`);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new Error(`外部 API 响应超过限制 (${maxBytes} bytes)`);
    }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

const pendingApprovals = new Map<string, { toolId: string; args: Record<string, unknown>; expiresAt: number }>();

export function createExternalApproval(toolId: string, args: Record<string, unknown>): string {
  const token = randomUUID();
  pendingApprovals.set(token, { toolId, args: structuredClone(args), expiresAt: Date.now() + 5 * 60 * 1000 });
  return token;
}

export function consumeExternalApproval(token: string): { toolId: string; args: Record<string, unknown> } {
  const value = pendingApprovals.get(token);
  pendingApprovals.delete(token);
  if (!value || value.expiresAt < Date.now()) throw new Error("外部工具审批已失效，请重新发起");
  return { toolId: value.toolId, args: value.args };
}

export async function executeExternalTool(
  tool: ExternalToolConfig,
  args: Record<string, unknown>,
  confirmed = false
): Promise<string> {
  if (!tool.enabled) throw new Error("外部工具已禁用");
  validateArgs(tool, args);
  if (tool.permission === "write" && !confirmed) {
    return `EXTERNAL_PERMISSION_REQUIRED::${tool.id}::${createExternalApproval(tool.id, args)}`;
  }

  const secrets = getToolSecrets(tool.id);
  const url = new URL(interpolate(tool.url, args, secrets) as string);
  for (const [key, template] of Object.entries(tool.query)) {
    url.searchParams.set(key, interpolate(template, args, secrets) as string);
  }
  await assertPublicHttps(url);

  const headers = Object.fromEntries(Object.entries(tool.headers)
    .map(([key, value]) => [key, interpolate(value, args, secrets) as string]));
  let body: string | undefined;
  if (tool.method !== "GET" && tool.body !== null && tool.body !== undefined) {
    const rendered = interpolate(tool.body, args, secrets);
    body = typeof rendered === "string" ? rendered : JSON.stringify(rendered);
    if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
      headers["Content-Type"] = "application/json";
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), tool.timeoutMs);
  try {
    const response = await fetch(url, {
      method: tool.method,
      headers,
      body,
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) throw new Error("外部工具不允许 HTTP 重定向");
    const raw = await readLimitedResponse(response, tool.maxResponseBytes);
    if (!response.ok) throw new Error(`外部 API 返回 HTTP ${response.status}: ${raw.slice(0, 500)}`);
    let value: unknown = raw;
    try { value = JSON.parse(raw); } catch {}
    const selected = selectData(value, tool.responseDataPath);
    return typeof selected === "string" ? selected : JSON.stringify(selected, null, 2);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error(`外部工具请求超时 (${tool.timeoutMs}ms)`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
