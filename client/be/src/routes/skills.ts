// Skills API
// GET  /api/skills         — 已注册 Skill 列表
// POST /api/skills/generate — LLM 自动生成 Skill JSON
// POST /api/skills/save     — 保存新 Skill 到文件

import { Router, Request, Response } from "express";
import OpenAI from "openai";
import { registeredSkills, saveSkill, deleteSkill } from "../skills/loader";
import { Skill } from "../types";
import { getConversationsDir } from "../runtime-data";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { createAiClient, getCurrentModel } from "../ai-settings";

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
  const skills = registeredSkills.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    input: s.input,
    output: s.output,
    requiredTools: s.requiredTools,
    keywords: s.keywords,
  }));
  res.json({ skills });
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
  "skill": { "id": "kebab-case", "name": "中文名称", "description": "一句话描述", "systemPrompt": "详细可执行的系统提示词", "input": { "type": "object", "properties": { "request": { "type": "string", "description": "用户本次需求" } }, "required": ["request"] }, "output": { "type": "object", "properties": {} }, "requiredTools": [], "keywords": ["至少5个关键词"] }
}

历史操作：
${operations.map((operation, index) => `${index + 1}. ${operation}`).join("\n")}`;

  try {
    const response = await getClient().chat.completions.create({
      model: MODEL,
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
  "keywords": ["关键", "词", "列表", "用于匹配用户意图", "5-15个"]
}
\`\`\`

## 要求
1. systemPrompt 是核心，要写好——明确角色、能力边界、输出格式
2. keywords 要覆盖用户可能的各种说法（5-15 个中文关键词）
3. input 的 properties 根据实际需要来，至少有一个字段
4. output 简单写即可，不必太复杂
5. 只输出 JSON，不要有任何其他文字
6. JSON 必须合法，不要有注释、不要用 markdown 代码块包裹

用户描述：${description}`;

  try {
    const response = await getClient().chat.completions.create({
      model: getCurrentModel(),
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
