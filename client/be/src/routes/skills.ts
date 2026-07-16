// Skills API
// GET  /api/skills         — 已注册 Skill 列表
// POST /api/skills/generate — LLM 自动生成 Skill JSON
// POST /api/skills/save     — 保存新 Skill 到文件
// POST /api/skills/download — 从 Hub 下载 Skill 到本地

import { Router, Request, Response } from "express";
import OpenAI from "openai";
import { resolveModel } from "../models";
import { registeredSkills, saveSkill, deleteSkill } from "../skills/loader";
import { Skill } from "../types";

const router = Router();

// ===== Skill Hub 代理 =====
const SKILL_HUB_URL = process.env.SKILL_HUB_URL || "https://wahtway-production.up.railway.app";

// GET /api/hub/skills — 代理 Hub 列表（支持搜索/排序）
router.get("/hub/list", async (req: Request, res: Response) => {
  try {
    const params = new URLSearchParams();
    if (req.query.q) params.set("q", String(req.query.q));
    if (req.query.sort) params.set("sort", String(req.query.sort));
    if (req.query.category) params.set("category", String(req.query.category));

    const response = await fetch(`${SKILL_HUB_URL}/api/skills?${params.toString()}`);
    if (!response.ok) throw new Error(`Hub 返回 HTTP ${response.status}`);
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Hub 连接失败: ${err.message}` });
  }
});

// GET /api/hub/skills/:id — 代理 Hub 单个 Skill 详情
router.get("/hub/skills/:id", async (req: Request, res: Response) => {
  try {
    const response = await fetch(`${SKILL_HUB_URL}/api/skills/${req.params.id}`);
    if (!response.ok) throw new Error(`Hub 返回 HTTP ${response.status}`);
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Hub 连接失败: ${err.message}` });
  }
});

// DeepSeek 客户端（延迟初始化）
let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    });
  }
  return _client;
}
const MODEL = resolveModel(process.env.DEEPSEEK_MODEL);

// GET /api/skills — 已注册 Skill 列表（脱敏）
router.get("/", (_req: Request, res: Response) => {
  const skills = registeredSkills.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    systemPrompt: s.systemPrompt,
    input: s.input,
    output: s.output,
    requiredTools: s.requiredTools,
    keywords: s.keywords,
  }));
  res.json({ skills });
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
      model: MODEL,
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

// POST /api/skills/download — 从服务端下载 Skill 到本地
router.post("/download", async (req: Request, res: Response) => {
  const { serverUrl, skillId } = req.body;
  if (!skillId) {
    res.status(400).json({ error: "请提供 skillId" });
    return;
  }

  try {
    const base = (serverUrl || SKILL_HUB_URL).replace(/\/$/, "");
    const url = `${base}/api/skills/${encodeURIComponent(skillId)}/download`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    // Hub 下载返回 { skill, version, checksum, source } 或 raw Skill JSON
    const skill = data.skill || data;
    saveSkill(skill as Skill);
    res.json({ success: true, skill });
  } catch (err: any) {
    res.status(500).json({ error: `下载失败: ${err.message}` });
  }
});

// GET /api/skills/search?q= — 模糊搜索 Skill
router.get("/search", (req: Request, res: Response) => {
  const q = (typeof req.query.q === "string" ? req.query.q : "").toLowerCase();
  if (!q) { res.json({ skills: [] }); return; }
  const results = registeredSkills
    .filter((s) => {
      const haystack = [s.name, s.description, ...(s.keywords || [])].join(" ").toLowerCase();
      return haystack.includes(q);
    })
    .map((s) => ({ id: s.id, name: s.name, description: s.description, keywords: s.keywords }));
  res.json({ skills: results });
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
