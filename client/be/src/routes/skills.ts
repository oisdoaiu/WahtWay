// Skills API
// GET  /api/skills         — 已注册 Skill 列表
// POST /api/skills/generate — LLM 自动生成 Skill JSON
// POST /api/skills/save     — 保存新 Skill 到文件

import { Router, Request, Response } from "express";
import OpenAI from "openai";
import { registeredSkills, saveSkill, deleteSkill } from "../skills/loader";
import { convertToManifest } from "../skills/converter";
import { Skill } from "../types";
import { getConversationsDir } from "../runtime-data";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { createAiClient, getCurrentModel, isAiConfigured } from "../ai-settings";
import { resolveModel } from "../models";
import { formatLlmError } from "../llm-errors";
import { getAllTools } from "../tools/registry";
import { listExternalTools } from "../external-tools/repository";
import { listPublicMcpServers } from "../mcp/runtime";
import { createSkillDependencySnapshot, getSkillDependencyHealth } from "../skills/dependency-health";

const router = Router();
const DEFAULT_SKILL_HUB_URL = "https://wahtway-production.up.railway.app";

function getSkillHubUrl(): string {
  return (process.env.SKILL_HUB_URL || DEFAULT_SKILL_HUB_URL).trim().replace(/\/+$/, "");
}

export function buildHubListUrl(query: Request["query"]): string {
  const url = new URL("/api/skills", getSkillHubUrl());
  for (const key of ["q", "sort", "category", "tag"] as const) {
    const value = query[key];
    if (typeof value === "string" && value.trim()) url.searchParams.set(key, value.trim());
  }
  return url.toString();
}

export function buildHubDownloadUrl(skillId: string): string {
  return `${getSkillHubUrl()}/api/skills/${encodeURIComponent(skillId)}/download`;
}

export function buildHubReviewUrl(skillId: string): string {
  return `${getSkillHubUrl()}/api/skills/${encodeURIComponent(skillId)}/review`;
}

async function fetchHubJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Hub 返回 HTTP ${response.status}`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function postHubJson(url: string, body: unknown): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Hub 返回 HTTP ${response.status}`);
    return payload;
  } finally { clearTimeout(timeout); }
}

function getClient(): OpenAI {
  return createAiClient();
}

interface HistoryMessage {
  role?: string;
  content?: unknown;
}

interface HistorySnapshot {
  operations: string[];
  expiresAt: number;
}

const historySnapshots = new Map<string, HistorySnapshot>();
const HISTORY_SNAPSHOT_TTL_MS = 10 * 60 * 1000;

export interface SkillToolCatalogItem {
  name: string;
  description: string;
  source: "builtin" | "external" | "mcp";
  risk: "read" | "write" | "destructive";
  permission: "auto" | "confirm" | "disabled";
  available: boolean;
}

function builtinRisk(name: string): SkillToolCatalogItem["risk"] {
  if (/delete|command|execute|move|write|create|copy|fill-template/i.test(name)) return "destructive";
  if (/update|organize|summarize/i.test(name)) return "write";
  return "read";
}

export function buildSkillToolCatalog(): SkillToolCatalogItem[] {
  const external = new Map(listExternalTools().map((tool) => [`external-${tool.id}`, tool]));
  const mcp = new Map<string, any>();
  for (const server of listPublicMcpServers()) {
    for (const tool of server.status.tools) mcp.set(tool.registeredName, tool);
  }
  return getAllTools().map((tool) => {
    const mcpTool = mcp.get(tool.name);
    if (mcpTool) return {
      name: tool.name, description: tool.description, source: "mcp" as const,
      risk: mcpTool.risk, permission: mcpTool.permission || "confirm", available: true,
    };
    const externalTool = external.get(tool.name);
    if (externalTool) return {
      name: tool.name, description: tool.description, source: "external" as const,
      risk: externalTool.permission === "write" ? "write" as const : "read" as const,
      permission: externalTool.permission === "write" ? "confirm" as const : "auto" as const,
      available: true,
    };
    const risk = builtinRisk(tool.name);
    return {
      name: tool.name, description: tool.description, source: "builtin" as const, risk,
      permission: risk === "destructive" ? "confirm" as const : "auto" as const, available: true,
    };
  }).sort((left, right) => left.source.localeCompare(right.source) || left.name.localeCompare(right.name));
}

function redactOperation(text: string): string {
  return text
    .replace(/(?:https?:\/\/|www\.)[^\s"'`]+/gi, "[链接]")
    .replace(/[A-Za-z]:\\(?:[^\\\s"'`]|\\ )+/g, "[本地路径]")
    .replace(/(?:\/[^\s"'`]+){2,}/g, "[本地路径]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[邮箱]")
    .replace(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g, "[手机号]")
    .replace(/\b(?:sk|rk|pk|ak|ghp|github_pat|xox[baprs])[-_A-Za-z0-9]{10,}\b/gi, "[密钥]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [密钥]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[密钥]")
    .replace(/\b(password|passwd|pwd|secret|token|api[_ -]?key|authorization)\s*([:=]|是)\s*[^\s,;，；]+/gi, "$1$2[密钥]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function getRecentUserOperations(): string[] {
  const dir = getConversationsDir();
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir)
    .filter((file) => /^\d+\.json$/.test(file))
    .map((file) => ({ file, updatedAt: fs.statSync(path.join(dir, file)).mtimeMs }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const operations: string[] = [];

  for (const { file } of files) {
    if (operations.length >= 80) break;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
      const messages = Array.isArray(data.messages) ? data.messages as HistoryMessage[] : [];
      for (const message of messages) {
        if (message.role !== "user" || typeof message.content !== "string") continue;
        const operation = redactOperation(message.content);
        if (operation) operations.push(operation);
        if (operations.length >= 80) break;
      }
    } catch {
      // Ignore an unreadable historical conversation.
    }
  }
  return operations;
}

// GET /api/skills — 已注册 Skill 列表（脱敏）
router.get("/", (_req: Request, res: Response) => {
  const dependencySnapshot = createSkillDependencySnapshot();
  const skills = registeredSkills.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    input: s.input,
    output: s.output,
    requiredTools: s.requiredTools,
    allowedTools: s.allowedTools,
    mcpBindings: s.mcpBindings,
    keywords: s.keywords,
    modeCategory: s.modeCategory,
    modeColor: s.modeColor,
    modeIcon: s.modeIcon,
    welcomeMessage: s.welcomeMessage,
    modeExamples: s.modeExamples,
    dependencyHealth: getSkillDependencyHealth(s, dependencySnapshot),
  }));
  res.json({ skills });
});

router.get("/tools/catalog", (_req: Request, res: Response) => {
  res.json({ tools: buildSkillToolCatalog() });
});

router.get("/:id/dependencies", (req: Request, res: Response) => {
  const skill = registeredSkills.find((item) => item.id === req.params.id);
  if (!skill) return res.status(404).json({ error: "Skill 不存在" });
  res.setHeader("Cache-Control", "no-store");
  res.json({ skillId: skill.id, dependencyHealth: getSkillDependencyHealth(skill) });
});

export function buildMcpAssistantSkill(serverId: string, tool: any): Skill {
  const base = `mcp-${serverId}-${tool.name}-assistant`.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/g, "");
  return {
    id: base,
    name: `${tool.name} 助手`,
    description: `使用 ${tool.name} MCP 工具完成相关任务`,
    systemPrompt: `你是 ${tool.name} MCP 工具的专用助手。\n\n你的主要职责是理解用户目标，并在需要时调用 ${tool.registeredName} 完成任务。不要假装已经执行工具；必须以真实工具结果为依据。工具需要审批时，清楚说明即将进行的操作并等待用户决定。工具不可用或执行失败时，说明原因并提供可行的下一步。\n\n工具说明：${tool.description}\n输入结构：${JSON.stringify(tool.inputSchema)}`,
    input: { type: "object", properties: { request: { type: "string", description: "用户希望 MCP 工具完成的任务" } }, required: ["request"] },
    output: { type: "object", properties: {} },
    requiredTools: [],
    allowedTools: [tool.registeredName],
    mcpBindings: [{ serverId, toolName: tool.name, registeredName: tool.registeredName }],
    whenToUse: `用户的请求需要使用 ${tool.name} MCP 工具时使用；普通闲聊或与该工具无关时不要使用。`,
    keywords: [tool.name, serverId, "MCP", "工具助手", "自动化"],
    modeCategory: "工具",
    modeColor: tool.risk === "destructive" ? "#c62828" : tool.risk === "write" ? "#856404" : "#1a73e8",
    modeIcon: "🔧",
    welcomeMessage: `告诉我你希望 ${tool.name} 工具完成什么任务。`,
    modeExamples: [`使用 ${tool.name} 完成任务`],
    origin: "custom",
  };
}

router.post("/mcp-assistant", (req: Request, res: Response) => {
  const serverId = typeof req.body?.serverId === "string" ? req.body.serverId : "";
  const toolName = typeof req.body?.toolName === "string" ? req.body.toolName : "";
  const server = listPublicMcpServers().find((item) => item.id === serverId);
  if (!server) return res.status(404).json({ error: "MCP Server 不存在" });
  const tool = server.status.tools.find((item) => item.name === toolName);
  if (!tool) return res.status(404).json({ error: "MCP 工具当前不可用" });
  if (tool.permission === "disabled") return res.status(400).json({ error: "已禁用的 MCP 工具不能创建助手" });
  const skill = buildMcpAssistantSkill(serverId, tool);
  if (registeredSkills.some((item) => item.id === skill.id)) {
    return res.status(409).json({ error: "该 MCP 工具已经存在对应助手", skillId: skill.id });
  }
  try {
    saveSkill(skill);
    res.status(201).json({ success: true, skill });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/skills/learn-from-history/preview — 创建用户可检查的一次性历史快照
router.post("/learn-from-history/preview", (_req: Request, res: Response) => {
  const operations = getRecentUserOperations();
  if (operations.length < 3) {
    res.status(400).json({ error: "至少需要 3 条历史操作，才能归纳常用 Skill" });
    return;
  }

  const now = Date.now();
  for (const [token, snapshot] of historySnapshots) {
    if (snapshot.expiresAt <= now) historySnapshots.delete(token);
  }
  const token = randomUUID();
  historySnapshots.set(token, { operations, expiresAt: now + HISTORY_SNAPSHOT_TTL_MS });
  res.json({ token, operations, sampleCount: operations.length });
});

// POST /api/skills/learn-from-history — 从历史用户操作中归纳一个候选 Skill
router.post("/learn-from-history", async (req: Request, res: Response) => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const snapshot = historySnapshots.get(token);
  historySnapshots.delete(token);
  if (!snapshot || snapshot.expiresAt <= Date.now()) {
    res.status(400).json({ error: "历史预览已过期，请重新确认要发送的内容" });
    return;
  }
  const operations = snapshot.operations;

  const prompt = `你是 WahtWay 的 Skill 设计助手。请从以下用户历史操作中识别一个重复出现、可复用的工作模式，并生成一个候选 Skill。

隐私规则：历史中的本地路径和密钥已被替换；不要猜测或输出任何原始路径、个人信息或密钥。
质量规则：只有在至少 3 条操作能支持同一个模式时，才返回 Skill。不要把泛化闲聊、单次请求或风险操作本身做成 Skill；Skill 应描述用户目标和稳定的执行流程，涉及写入、删除或命令执行时必须在 systemPrompt 中要求用户确认。

返回严格 JSON，不要 Markdown：
{
  "reason": "一句话说明识别到的重复模式和依据数量",
  "skill": { "id": "kebab-case", "name": "中文名称", "description": "一句话描述", "systemPrompt": "详细可执行的系统提示词", "input": { "type": "object", "properties": { "request": { "type": "string", "description": "用户本次需求" } }, "required": ["request"] }, "output": { "type": "object", "properties": {} }, "requiredTools": [], "keywords": ["至少5个关键词"], "modeCategory": "学习/开发/办公/生活/创作/其他之一", "modeColor": "#1a73e8", "modeIcon": "一个简短符号或 emoji", "welcomeMessage": "用户切换到此模式时看到的一句话提示，80字以内" }
}

历史操作：
${operations.map((operation, index) => `${index + 1}. ${operation}`).join("\n")}`;

  try {
    const response = await getClient().chat.completions.create({
      model,
      messages: [
        { role: "system", content: "只输出合法 JSON，不输出其他内容。" },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 2048,
      stream: false,
    });
    const raw = response.choices[0]?.message?.content || "";
    const jsonStr = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const result = JSON.parse(jsonStr);
    if (!result.skill || typeof result.skill !== "object") {
      res.status(422).json({ error: "未发现足够明确的重复操作模式，请积累更多相似操作后再试" });
      return;
    }
    res.json({ skill: result.skill, reason: typeof result.reason === "string" ? result.reason : "已根据历史操作生成候选 Skill", sampleCount: operations.length });
  } catch (err: any) {
    if (err instanceof SyntaxError) {
      res.status(500).json({ error: "历史归纳结果解析失败，请重试" });
      return;
    }
    res.status(500).json({ error: formatLlmError(err) });
  }
});

router.get("/hub/list", async (req: Request, res: Response) => {
  try {
    const payload = await fetchHubJson(buildHubListUrl(req.query));
    res.json({ skills: Array.isArray(payload.skills) ? payload.skills : [] });
  } catch (error: any) {
    res.status(502).json({ error: `Skill Hub 加载失败: ${error.message}` });
  }
});

router.post("/hub/:skillId/review", async (req: Request, res: Response) => {
  const rating = Number(req.body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    res.status(400).json({ error: "评分必须是 1 到 5 的整数" });
    return;
  }
  try {
    const reviewerId = typeof req.body?.reviewerId === "string" ? req.body.reviewerId : undefined;
    res.status(201).json(await postHubJson(buildHubReviewUrl(req.params.skillId), { rating, reviewerId }));
  } catch (error: any) { res.status(502).json({ error: `提交评分失败: ${error.message}` }); }
});

// GET /api/skills/:id — 单个 Skill 完整定义（编辑用）
router.get("/:id", (req: Request, res: Response) => {
  const skill = registeredSkills.find((s) => s.id === req.params.id);
  if (!skill) {
    res.status(404).json({ error: "Skill 不存在" });
    return;
  }
  res.json({ skill });
});

// POST /api/skills/generate — LLM 自动生成 Skill JSON
router.post("/generate", async (req: Request, res: Response) => {
  const { description } = req.body;

  if (!description || typeof description !== "string") {
    res.status(400).json({ error: "请提供 description 字段" });
    return;
  }

  const META_PROMPT = `你是一个 Skill 定义生成器。用户会描述他想要什么功能的助手，你需要输出一个完整的 Skill JSON 定义。

## Skill JSON 格式

\`\`\`json
{
  "id": "英文短标识（kebab-case，如 essay-outline）",
  "name": "中文展示名（简洁，5-10字）",
  "description": "一句话描述这个 Skill 做什么（给用户看，也用于匹配）",
  "systemPrompt": "给 LLM 的系统提示词，描述它的角色、能力、输出格式要求。要详细、具体、可执行。按 Markdown 格式输出。",
  "input": {
    "type": "object",
    "properties": {
      "参数名": { "type": "string/array等", "description": "参数说明" }
    },
    "required": ["必填参数名"]
  },
  "output": {
    "type": "object",
    "properties": {}
  },
  "requiredTools": [],
  "keywords": ["关键", "词", "列表", "用于匹配用户意图", "5-15个"],
  "modeCategory": "学习/开发/办公/生活/创作/其他之一",
  "modeColor": "#1a73e8",
  "modeIcon": "一个简短符号或 emoji",
  "welcomeMessage": "用户切换到此模式时看到的一句话提示，80字以内"
}
\`\`\`

## 要求
1. systemPrompt 是核心，要写好——明确角色、能力边界、输出格式
2. keywords 要覆盖用户可能的各种说法（5-15 个中文关键词）
3. input 的 properties 根据实际需要来，至少有一个字段
4. output 简单写即可，不必太复杂
5. 只输出 JSON，不要有任何其他文字
6. JSON 必须合法，不要有注释、不要用 markdown 代码块包裹
7. modeCategory、modeColor、modeIcon、welcomeMessage 用于聊天页模式切换，必须简洁、适合展示

用户描述：${description}`;

  try {
    const response = await getClient().chat.completions.create({
      model,
      messages: [
        { role: "system", content: "你只输出纯 JSON，不输出任何其他内容。" },
        { role: "user", content: META_PROMPT },
      ],
      temperature: 0.7,
      max_tokens: 2048,
      stream: false,
    });

    const raw = response.choices[0]?.message?.content || "";
    // 清理可能的 markdown 代码块包裹
    const jsonStr = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    try {
      const skill = JSON.parse(jsonStr);
      res.json({ skill });
    } catch {
      res.status(500).json({
        error: "LLM 生成的 JSON 解析失败",
        raw: jsonStr.slice(0, 500),
      });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/skills/save — 保存新 Skill 到文件
router.post("/save", (req: Request, res: Response) => {
  const skill = req.body as Skill;

  try {
    saveSkill(skill);
    res.json({ success: true, skillId: skill.id });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/skills/download — 从服务端下载 Skill
router.post("/download", async (req: Request, res: Response) => {
  const { skillId } = req.body;
  if (!skillId || typeof skillId !== "string") {
    res.status(400).json({ error: "请提供 skillId" });
    return;
  }

  try {
    const payload = await fetchHubJson(buildHubDownloadUrl(skillId));
    const skill = payload.skill || payload;
    if (payload.skill) {
      skill.hub = {
        skillId: payload.source?.skillId || skillId,
        version: payload.version,
        checksum: payload.checksum,
        downloadedAt: new Date().toISOString(),
      };
    }

    saveSkill(skill as Skill);
    res.json({ success: true, skill });
  } catch (err: any) {
    res.status(500).json({ error: `下载失败: ${err.message}` });
  }
});

// POST /api/skills/import-url — 从 URL 导入外部 Skill
router.post("/import-url", async (req: Request, res: Response) => {
  const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
  if (!url || !/^https?:\/\/.+/.test(url)) {
    res.status(400).json({ error: "请提供有效的 HTTPS URL（Skill JSON 原始地址）" });
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) throw new Error("URL 返回的是 HTML 页面，请提供 Skill JSON 文件的原始(raw)地址");
    const text = await response.text();
    if (text.length > 512 * 1024) throw new Error("JSON 文件过大（超过 512KB）");

    let raw: any;
    try { raw = JSON.parse(text); } catch { throw new Error("JSON 解析失败，请确认 URL 返回的是合法 JSON"); }

    // 统一转换为 Manifest v1
    const result = convertToManifest(raw, url, "json");
    if (!result.valid) throw new Error(result.warnings.join("; "));
    const skill = result.skill;
    const sid = skill.id as string;

    // 检查是否已存在
    if (registeredSkills.some(s => s.id === sid)) {
      res.status(409).json({ error: `Skill "${sid}" 已存在，请先删除再导入` });
      return;
    }

    saveSkill(skill as Skill);
    const warnMsg = result.warnings.length > 0 ? `（提示: ${result.warnings.join("; ")}）` : "";
    console.log(`[import-url] imported: ${skill.name} (${sid}) from ${url} ${warnMsg}`);
    res.json({ success: true, skill: { id: sid, name: skill.name, description: skill.description }, warnings: result.warnings });
  } catch (err: any) {
    res.status(500).json({ error: `导入失败: ${err.message}` });
  }
});

// POST /api/skills/import-file — 从本地文件导入 Skill
router.post("/import-file", async (req: Request, res: Response) => {
  const filePath = typeof req.body?.path === "string" ? req.body.path.trim() : "";
  if (!filePath) { res.status(400).json({ error: "请提供文件路径" }); return; }
  if (!fs.existsSync(filePath)) { res.status(400).json({ error: "文件不存在: " + filePath }); return; }

  const ext = require("path").extname(filePath).toLowerCase();
  if (ext !== ".json" && ext !== ".md" && ext !== ".markdown") {
    res.status(400).json({ error: "仅支持 .json、.md、.markdown 格式的 Skill 文件" });
    return;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    if (!content.trim()) throw new Error("文件内容为空");

    const format = ext === ".json" ? "json" : "markdown";
    const raw: any = format === "json" ? JSON.parse(content) : content;
    const result = convertToManifest(raw, filePath, format);
    if (!result.valid) throw new Error(result.warnings.join("; "));

    const skill = result.skill;
    const sid = skill.id as string;
    if (registeredSkills.some(s => s.id === sid)) {
      res.status(409).json({ error: `Skill "${sid}" 已存在，请先删除再导入` });
      return;
    }

    saveSkill(skill as Skill);
    console.log(`[import-file] imported: ${skill.name} (${sid}) from ${filePath}`);
    res.json({ success: true, skill: { id: sid, name: skill.name, description: skill.description }, warnings: result.warnings });
  } catch (err: any) {
    res.status(500).json({ error: `导入失败: ${err.message}` });
  }
});

// POST /api/skills/summarize — 对扫描结果生成中文简介
router.post("/summarize", async (req: Request, res: Response) => {
  const items = req.body?.items as any[];
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "请提供 items 数组" });
    return;
  }
  if (!isAiConfigured()) { res.json({ summaries: [] }); return; }

  try {
    const client = createAiClient();
    const deep = req.body?.mode === "deep";
    const model = deep ? "deepseek-v4-pro" : "deepseek-v4-flash";
    const summaries: Array<{ id: string; summary: string; welcomeMessage: string }> = [];
    console.log(`[summarize] ${items.length} items, model=${model}`);
    for (const item of items) {
      try {
        const descMsg = `用中文（30-50字）描述下面这个工具是做什么的，只输出中文结果：\n名称：${item.name}\n简介：${(item.description || "").slice(0, 500)}`;
        const welcomeMsg = `用中文写一句热情的欢迎语（30字以内），告诉用户把什么发给你、你能帮他们做什么。只输出中文：\n名称：${item.name}\n描述：${(item.description || "").slice(0, 300)}`;


        const [descResp, welcomeResp] = await Promise.all([
          client.chat.completions.create({ model, messages: [{ role: "user", content: descMsg }], temperature: 0, stream: false }),
          client.chat.completions.create({ model, messages: [{ role: "user", content: welcomeMsg }], temperature: 0.3, stream: false }),
        ]);


        const summary = descResp.choices[0]?.message?.content?.trim() || "";
        const welcome = welcomeResp.choices[0]?.message?.content?.trim() || "";
        if (summary) summaries.push({ id: item.id, summary, welcomeMessage: welcome || `你好！我是${item.name}助手，有什么可以帮你的？` });
      } catch (e: any) { console.log(`[summarize] ${item.name}: FAILED - ${e.message}`); }
    }
    res.json({ summaries });
  } catch (e: any) { res.status(502).json({ error: `生成失败: ${e.message}` }); }
});

// POST /api/skills/scan-repo — 扫描 GitHub 仓库中的 Skill
router.post("/scan-repo", async (req: Request, res: Response) => {
  const repoUrl = typeof req.body?.repoUrl === "string" ? req.body.repoUrl.trim() : "";
  if (!repoUrl) { res.status(400).json({ error: "请提供 GitHub 仓库 URL" }); return; }
  console.log(`[scan-repo] request: ${repoUrl}`);

  // 解析 GitHub URL: https://github.com/owner/repo 或 /tree/branch/path
  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\/tree\/([^\/]+)\/(.+))?\/?(?:\.git)?$/);
  if (!match) { res.status(400).json({ error: "URL 格式不正确，示例: https://github.com/user/repo" }); return; }

  const [, owner, repo, branch, subPath] = match;
  const ref = branch || "main";
  const base = subPath ? `${subPath}/` : "";
  const oversizedFiles: any[] = [];

  const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json", "User-Agent": "WahtWay" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  let rateLimited = false;
  const gitHubFetch = async (url: string, timeoutMs = 10000): Promise<Response> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(url, { headers, signal: ctrl.signal });
    clearTimeout(t);
    if (resp.status === 403 || resp.status === 429) {
      const remaining = resp.headers.get("x-ratelimit-remaining");
      if (remaining === "0" || resp.status === 429) rateLimited = true;
    }
    return resp;
  };
  const rateLimitMsg = process.env.GITHUB_TOKEN
    ? "GitHub API 限流，当前 Token 额度已耗尽，请稍后再试。"
    : "GitHub API 限流（匿名 60 次/小时）。可免费添加 Token 提升至 5000 次/小时——点击下方按钮查看教程。";
  const rateLimitError = () => ({ error: rateLimitMsg, candidates: [], message: rateLimitMsg, rateLimited: true });

  try {
    // 策略1: 先尝试读取 skills.json 清单
    let candidates: Array<{ id: string; name: string; description: string; path: string; source: string }> = [];
    let collectionName = `${owner}/${repo}`;
    let collectionDesc = "";

    // 策略1: 读取 skills.json 清单
    try {
      const mr = await gitHubFetch(`https://api.github.com/repos/${owner}/${repo}/contents/${base}skills.json?ref=${ref}`);
      if (mr.ok) {
        const fe = await mr.json().catch(() => ({}));
        const manifest = fe.content ? JSON.parse(Buffer.from(fe.content, fe.encoding || "base64").toString("utf-8")) : {};
        if (Array.isArray(manifest.skills)) {
          collectionName = manifest.name || collectionName;
          collectionDesc = manifest.description || "";
          candidates = manifest.skills
            .filter((s: any) => s.id && s.path)
            .map((s: any) => ({
              id: s.id,
              name: s.name || s.id,
              description: s.description || "",
              path: `${base}${s.path}`.replace(/^\/+/, ""),
              source: `https://github.com/${owner}/${repo}`,
            }));
        }
      }
    } catch { /* 无清单，走策略2 */ }

    // 策略2: 目录扫描 — 只 1 次 API 调用来列目录，文件内容走 raw
    if (candidates.length === 0) {
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${base}`.replace(/\/$/, "");
      const dirResp = await gitHubFetch(apiUrl);
      if (!dirResp.ok) {
        if (rateLimited) { res.status(502).json(rateLimitError()); return; }
        res.status(502).json({ error: `GitHub API 返回 ${dirResp.status}（仓库可能为私有或不存在）` });
        return;
      }
      const entries: any[] = await dirResp.json().catch(() => []);
      if (!Array.isArray(entries)) {
        res.status(400).json({ error: "该 URL 不是目录" });
        return;
      }

      // 筛选候选文件，超大文件跳过（>100KB 不太可能是 Skill）
      const KB = 1024;
      const MAX_SIZE = 100 * KB;
      const skipJson = new Set(["package.json", "package-lock.json", "tsconfig.json", ".eslintrc.json", "manifest.json", ".prettierrc.json"]);
      const skipMd = new Set(["readme.md", "license.md", "contributing.md", "changelog.md", "code_of_conduct.md", "security.md"]);
      const targetFiles = entries.filter((e: any) => {
        if (e.type !== "file") return false;
        const ext = e.name.toLowerCase();
        if (e.name.endsWith(".json") && !skipJson.has(e.name)) return true;
        if ((e.name.endsWith(".md") || e.name.endsWith(".markdown")) && !skipMd.has(ext)) return true;
        return false;
      }).filter((e: any) => {
        if (e.size > MAX_SIZE) { oversizedFiles.push(e); return false; }
        return true;
      });

      // 并行获取文件内容（GitHub API）
      const CONCURRENCY = 4;
      for (let i = 0; i < targetFiles.length; i += CONCURRENCY) {
        const batch = targetFiles.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(batch.map(async (entry: any) => {
          const resp = await gitHubFetch(`https://api.github.com/repos/${owner}/${repo}/contents/${entry.path}?ref=${ref}`);
          if (!resp.ok) return null;
          const fe = await resp.json().catch(() => null);
          if (!fe?.content) return null;
          return { entry, content: Buffer.from(fe.content, fe.encoding || "base64").toString("utf-8") };
        }));

        for (const r of results) {
          if (r.status !== "fulfilled" || !r.value) continue;
          const { entry, content } = r.value;
          const isMd = entry.name.endsWith(".md") || entry.name.endsWith(".markdown");

          let skillName = entry.name.replace(/\.(json|md|markdown)$/i, "");
          let skillDesc = "";
          let skillId = skillName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-|-$/g, "");

          if (isMd) {
            const titleMatch = content.match(/^#\s+(.+)/m);
            if (titleMatch) skillName = titleMatch[1].trim().replace(/\*\*/g, "").replace(/`/g, "");
            const blockMatch = content.match(/#\s+.+\n+(.+?)(?:\n##|\n---|\n\`\`\`|\n\n\n)/s);
            if (blockMatch) {
              const lines = blockMatch[1].split(/\n/);
              for (const line of lines) {
                const clean = line.trim();
                if (!clean || /^[>|#\-*\`\[]/.test(clean) || clean.startsWith("---")) continue;
                skillDesc = clean.replace(/[*_\`~]/g, "").slice(0, 200);
                if (skillDesc) break;
              }
            }
            if (!skillDesc) {
              for (const line of content.split(/\n/)) {
                const clean = line.trim();
                if (clean.length > 10 && !/^[#>\-*|\`\[]/.test(clean) && !clean.startsWith("---")) {
                  skillDesc = clean.replace(/[*_\`~]/g, "").slice(0, 200);
                  break;
                }
              }
            }
          } else {
            try {
              const obj = JSON.parse(content);
              if (obj.name) skillName = obj.name;
              skillDesc = obj.description || "";
              if (!skillDesc && obj.systemPrompt) {
                const firstSentence = obj.systemPrompt.split(/[。.\n]/)[0].trim();
                if (firstSentence.length > 6 && firstSentence.length < 200) skillDesc = firstSentence;
              }
              if (obj.id) skillId = obj.id;
            } catch { /* ignore */ }
          }
          if (!skillDesc) skillDesc = `${skillName} — 从 GitHub 仓库扫描识别`;

          candidates.push({
            id: skillId, name: skillName, description: skillDesc,
            path: entry.path, source: `https://github.com/${owner}/${repo}`,
            format: isMd ? "markdown" : "json",
          });
        }
      }
    }

    if (candidates.length === 0) {
      res.json({ candidates: [], message: "未发现 Skill。建议在仓库根目录放一个 skills.json 清单文件。" });
      return;
    }

    // 标记需要 LLM 摘要，前端后续调用 /summarize 获取中文简介
    for (const c of candidates) {
      c.pendingSummary = true;
      c.description = c.description || "";
    } // end if isAiConfigured

    // 超大文件（>100KB）单独列出，需用户确认后才扫描
    const oversized = oversizedFiles.map((e: any) => ({
      id: e.name.replace(/\.(json|md|markdown)$/i, ""),
      name: e.name,
      size: e.size,
      path: e.path,
      source: `https://github.com/${owner}/${repo}`,
    }));

    if (rateLimited) { res.status(502).json(rateLimitError()); return; }
    res.json({
      repo: { owner, name: repo, url: `https://github.com/${owner}/${repo}`, collectionName, collectionDesc },
      candidates,
      oversized: oversized.length > 0 ? oversized : undefined,
    });
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("scan-repo 异常:", msg, err?.stack || "");
    res.status(502).json({ error: `扫描仓库失败: ${msg}` });
  }
});

// POST /api/skills/batch-import — 从仓库批量导入 Skill
router.post("/batch-import", async (req: Request, res: Response) => {
  const { repoUrl, skillIds, skillPaths, descriptions, welcomeMessages } = req.body as { repoUrl?: string; skillIds?: string[]; skillPaths?: Record<string, string>; descriptions?: Record<string, string>; welcomeMessages?: Record<string, string> };
  if (!repoUrl || !Array.isArray(skillIds) || skillIds.length === 0) {
    res.status(400).json({ error: "请提供 repoUrl 和 skillIds 数组" });
    return;
  }
  const pathMap: Record<string, string> = skillPaths || {};

  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\/tree\/([^\/]+)\/(.+))?\/?(?:\.git)?$/);
  if (!match) { res.status(400).json({ error: "GitHub URL 格式不正确" }); return; }

  const [, owner, repo, branch, subPath] = match;
  const ref = branch || "main";
  const base = subPath ? `${subPath}/` : "";

  const installed: string[] = [];
  const errors: string[] = [];
  const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json", "User-Agent": "WahtWay" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  for (const skillId of skillIds) {
    try {
      // 有指定路径则直接用（超大文件确认导入时带来的）
      let skillPath = pathMap[skillId] || `${base}${skillId}.json`;
      let isMd = false;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const mr = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${base}skills.json?ref=${ref}`, { signal: ctrl.signal, headers });
        clearTimeout(t);
        if (mr.ok) {
          const entry = await mr.json().catch(() => ({}));
          const manifestContent = entry.content ? Buffer.from(entry.content, entry.encoding || "base64").toString("utf-8") : null;
          const manifest = manifestContent ? JSON.parse(manifestContent) : ({} as any);
          const found = manifest.skills?.find((s: any) => s.id === skillId);
          if (found?.path) { skillPath = `${base}${found.path}`.replace(/^\/+/, ""); isMd = found.path.endsWith(".md"); }
        }
      } catch { /* use default path */ }

      // 通过 GitHub API content 端点获取文件
      let apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${skillPath}?ref=${ref}`;
      const ctrl2 = new AbortController();
      const t2 = setTimeout(() => ctrl2.abort(), 10000);
      let fr = await fetch(apiUrl, { headers, signal: ctrl2.signal });
      clearTimeout(t2);

      // 如果 .json 404，尝试 .md
      if (!fr.ok && !isMd) {
        const mdPath = skillPath.replace(/\.json$/, ".md");
        const ctrl3 = new AbortController();
        const t3 = setTimeout(() => ctrl3.abort(), 10000);
        fr = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${mdPath}?ref=${ref}`, { headers, signal: ctrl3.signal });
        clearTimeout(t3);
        if (fr.ok) { skillPath = mdPath; isMd = true; }
      }

      if (!fr.ok) throw new Error(`HTTP ${fr.status}`);
      const fileEntry = await fr.json().catch(() => { throw new Error("GitHub API 响应异常"); });
      if (!fileEntry.content) throw new Error("文件内容为空");
      const content = Buffer.from(fileEntry.content, fileEntry.encoding || "base64").toString("utf-8");

      const format = (isMd || skillPath.endsWith(".md")) ? "markdown" : "json";
      const raw: any = format === "json" ? JSON.parse(content) : content;
      const result = convertToManifest(raw, `https://github.com/${owner}/${repo}`, format);
      if (!result.valid) { errors.push(`${skillId}: ${result.warnings.join("; ") || "格式转换失败"}`); continue; }

      const skill = result.skill;
      const sid = skill.id as string;
      if (registeredSkills.some(s => s.id === sid)) {
        errors.push(`${skillId}: 已存在`);
        continue;
      }

      if (descriptions?.[skillId]) (skill as any).description = descriptions[skillId];
      if (welcomeMessages?.[skillId]) (skill as any).welcomeMessage = welcomeMessages[skillId];
      saveSkill(skill as Skill);
      installed.push(skill.name || skillId);
      console.log(`[batch-import] imported: ${skill.name} (${skill.id}) from ${repoUrl}`);
    } catch (e: any) {
      errors.push(`${skillId}: ${e.message}`);
    }
  }

  res.json({ success: true, installed, errors });
});

// DELETE /api/skills/:id — 删除 Skill
router.delete("/:id", (req: Request, res: Response) => {
  try {
    deleteSkill(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
