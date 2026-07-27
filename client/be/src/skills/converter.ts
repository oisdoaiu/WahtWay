// Skill 格式转换器 — 将外部 Skill（JSON / Markdown）统一转为 WahtWay Manifest v1
// 对齐 docs/Skill统一格式规范.md

export interface ConvertResult {
  skill: Record<string, unknown>;
  warnings: string[];
  valid: boolean;
}

const DEFAULT_INPUT: Record<string, unknown> = {
  type: "object",
  properties: {
    request: { type: "string", description: "用户的需求" },
  },
  required: ["request"],
};

const DEFAULT_OUTPUT: Record<string, unknown> = {
  type: "object",
  properties: {},
};

const MODE_CATEGORY_HINTS: Array<{ keywords: string[]; category: string }> = [
  { keywords: ["代码", "编程", "review", "debug", "开发", "api", "git"], category: "开发" },
  { keywords: ["学习", "笔记", "复习", "考试", "课程", "论文", "翻译", "阅读"], category: "学习" },
  { keywords: ["会议", "纪要", "汇报", "ppt", "文档", "周报", "日报", "邮件"], category: "办公创作" },
  { keywords: ["生活", "旅行", "健身", "食谱", "穿搭", "记账"], category: "生活" },
];

function guessModeCategory(text: string): string {
  const lower = text.toLowerCase();
  for (const hint of MODE_CATEGORY_HINTS) {
    if (hint.keywords.some((kw) => lower.includes(kw))) return hint.category;
  }
  return "常用";
}

export function convertToManifest(
  raw: Record<string, unknown>,
  source: string,
  format: "json" | "markdown"
): ConvertResult {
  const warnings: string[] = [];

  if (format === "markdown") {
    return convertMarkdownToManifest(raw as unknown as string, source);
  }

  // JSON 格式：补齐缺失字段，校验约束
  const skill = { ...raw };
  const id = typeof skill.id === "string" ? skill.id.trim() : "";
  if (!id) return { skill: {}, warnings: ["缺少 id 字段"], valid: false };

  // 确保 id 是 kebab-case
  const kebabId = id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (kebabId !== id) {
    warnings.push(`id "${id}" 已规范化为 "${kebabId}"`);
    skill.id = kebabId;
  }

  // 补齐必填字段
  if (!skill.name || typeof skill.name !== "string") {
    skill.name = id;
    warnings.push("缺少 name，使用 id 代替");
  }
  if (!skill.description || typeof skill.description !== "string") {
    skill.description = (skill.name as string) || id;
    warnings.push("缺少 description，使用 name 代替");
  }
  if (!skill.systemPrompt || typeof skill.systemPrompt !== "string") {
    return { skill, warnings: ["缺少 systemPrompt，无法作为 Skill 使用"], valid: false };
  }
  if (!skill.input || typeof skill.input !== "object") {
    skill.input = DEFAULT_INPUT;
    warnings.push("缺少 input，已填充默认值");
  }
  if (!skill.output || typeof skill.output !== "object") {
    skill.output = DEFAULT_OUTPUT;
    warnings.push("缺少 output，已填充默认值");
  }
  if (!Array.isArray(skill.requiredTools)) {
    skill.requiredTools = [];
  }
  if (!Array.isArray(skill.keywords) || skill.keywords.length === 0) {
    skill.keywords = typeof skill.name === "string" ? [skill.name] : [id];
    warnings.push("keywords 为空，使用 name 填充");
  }

  // 补齐可选字段默认值
  applyDefaults(skill, warnings);

  // 清洗不符合规范的前端字段
  delete (skill as any).hub;
  delete (skill as any).source;
  delete (skill as any).downloadedAt;

  return { skill, warnings, valid: true };
}

export function convertMarkdownToManifest(
  content: string,
  source: string
): ConvertResult {
  const warnings: string[] = [];
  const lines = content.split(/\r?\n/);

  // 提取 # 标题作为 name
  const titleMatch = content.match(/^#\s+(.+)/m);
  const name = titleMatch ? titleMatch[1].trim().replace(/\*\*/g, "").replace(/`/g, "") : "未命名 Skill";

  // 提取第一段有意义的文字作为 description
  let description = "";
  let inContent = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.length > 10 && !trimmed.startsWith("```") && !trimmed.startsWith("- ")) {
      description = trimmed.slice(0, 200);
      break;
    }
  }
  if (!description) description = `${name} (从 Markdown 转换)`;

  // id 从 name 生成
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "imported-skill";

  // 提取代码块中的参数说明作为 input schema hints
  const inputProperties: Record<string, unknown> = {
    request: { type: "string", description: "用户的需求" },
  };

  const keywords: string[] = [];
  // 从二级标题提取关键词
  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)/);
    if (h2Match) keywords.push(h2Match[1].trim().slice(0, 20));
  }
  keywords.push(name);

  const skill: Record<string, unknown> = {
    id,
    name,
    description: description.slice(0, 500),
    systemPrompt: content.slice(0, 20000),
    input: {
      type: "object",
      properties: inputProperties,
      required: ["request"],
    },
    output: { type: "object", properties: {} },
    requiredTools: [],
    keywords: [...new Set(keywords)].slice(0, 30),
  };

  applyDefaults(skill, warnings);
  delete (skill as any).hub;

  return { skill, warnings, valid: true };
}

function applyDefaults(skill: Record<string, unknown>, warnings: string[]): void {
  if (!skill.allowedTools || !Array.isArray(skill.allowedTools)) {
    skill.allowedTools = [];
  }
  if (!skill.whenToUse || typeof skill.whenToUse !== "string") {
    skill.whenToUse = `用户需要${skill.name || skill.id}相关功能时触发。`;
  }
  if (typeof skill.version !== "number") {
    skill.version = 1;
  }
  if (!skill.origin || typeof skill.origin !== "string") {
    skill.origin = "hub";
  }
  if (!skill.modeCategory || typeof skill.modeCategory !== "string") {
    const text = [
      skill.description,
      skill.systemPrompt,
      ...(Array.isArray(skill.keywords) ? skill.keywords as string[] : []),
    ].join(" ");
    skill.modeCategory = guessModeCategory(text);
  }
  if (!skill.modeColor || typeof skill.modeColor !== "string" || !/^#[0-9a-fA-F]{6}$/.test(skill.modeColor as string)) {
    skill.modeColor = "#1a73e8";
  }
  if (!skill.modeIcon || typeof skill.modeIcon !== "string") {
    skill.modeIcon = "ri-robot-2-line";
  }
  if (!skill.welcomeMessage || typeof skill.welcomeMessage !== "string") {
    skill.welcomeMessage = typeof skill.description === "string" ? skill.description.slice(0, 160) : "";
  }
  if (!Array.isArray(skill.modeExamples)) {
    skill.modeExamples = [];
  }

  // 截断超长字段
  if (typeof skill.name === "string") skill.name = (skill.name as string).slice(0, 80);
  if (typeof skill.description === "string") skill.description = (skill.description as string).slice(0, 500);
  if (typeof skill.systemPrompt === "string") skill.systemPrompt = (skill.systemPrompt as string).slice(0, 20000);
}
