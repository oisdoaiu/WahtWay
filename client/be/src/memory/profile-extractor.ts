import OpenAI from "openai";
import { readConversation } from "../conversations/repository";
import {
  createMemoryItem,
  listMemoryItems,
  updateMemoryItem,
  type MemoryCategory,
  type MemoryItem,
} from "./repository";
import { resolveModel } from "../models";

const MIN_MESSAGES = 4; // 少于 4 条已完成消息不提取
const PROFILE_DELTA = 3; // 自上次提取后新增 >=3 条才重新提取（节流）
const MATERIAL_MESSAGES = 12; // 每次提炼最多送最近 12 条作为素材
const SIM_THRESHOLD = 0.5; // 关键词 Jaccard 相似度 >=0.5 视为重复
const MAX_CANDIDATES = 6;

let queue = Promise.resolve();
// 记录每个对话上次处理到的最后一条消息 id，用于节流
const lastProfiledId = new Map<string, string>();

export type ProfileCategory = MemoryCategory;

export interface ProfileCandidate {
  category: ProfileCategory;
  content: string;
}

export type ProfileMutation =
  | { kind: "create"; candidate: ProfileCandidate }
  | { kind: "update"; id: string; content: string };

const CATEGORIES: ProfileCategory[] = ["preference", "profile", "project", "instruction", "other"];

const PROFILE_SYSTEM_PROMPT = `你是从对话中提取用户画像与偏好的助手。已知画像列表见 existingProfiles（已保存，避免重复）。
请阅读 recentConversation，提取稳定、跨对话有用、用户主动透露或明确偏好的事实，例如：
- profile：姓名、专业/职业、角色、所在城市、技术背景
- preference：编程语言/框架偏好、沟通风格、输出格式偏好
- project：正在进行的项目背景、技术栈
- instruction：用户的长期要求或约束
- other：其他稳定事实

只输出 JSON 数组，每条形如 {"category": "profile"|"preference"|"project"|"instruction"|"other", "content": "简洁陈述，中文"}。

规则：
1) 不提取一次性任务细节、临时上下文、模型推断或不确定信息；
2) 若 existingProfiles 中已有相同或高度相似条目，不要重复输出；
3) 不要编造信息；
4) 不要包含密码、密钥、token、身份证号等敏感信息；
5) 若无新信息，输出空数组 []。
最多输出 ${MAX_CANDIDATES} 条。`;

function getClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  });
}

// 容错解析 LLM 输出：支持 ```json 代码块、裸数组；过滤非法条目
export function parseProfileCandidates(raw: string): ProfileCandidate[] {
  if (!raw) return [];
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ProfileCandidate[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const content = typeof e.content === "string" ? e.content.trim() : "";
    if (!content) continue;
    const category = (CATEGORIES as string[]).includes(e.category as string)
      ? (e.category as ProfileCategory)
      : "other";
    out.push({ category, content: content.slice(0, 2000) });
  }
  return out;
}

// 字符级 2-gram 分词：对中文（无词间空格）友好，能捕捉子串重叠
function tokenize(s: string): Set<string> {
  const cleaned = s.toLowerCase().replace(/[\s\p{P}]+/gu, "");
  const grams = new Set<string>();
  if (cleaned.length === 0) return grams;
  if (cleaned.length <= 2) {
    grams.add(cleaned);
    return grams;
  }
  for (let i = 0; i < cleaned.length - 1; i++) {
    grams.add(cleaned.slice(i, i + 2));
  }
  return grams;
}

// 关键词 Jaccard 相似度
function similarity(a: string, b: string): number {
  const sa = tokenize(a);
  const sb = tokenize(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / Math.max(sa.size, sb.size);
}

// 纯函数：依据现有记忆对候选做去重/合并，产出 create/update 计划（不触碰存储）
export function planProfileMutations(
  candidates: ProfileCandidate[],
  existing: MemoryItem[]
): ProfileMutation[] {
  const result: ProfileMutation[] = [];
  for (const c of candidates) {
    const matches = existing
      .filter((e) => e.category === c.category || e.category === "other" || c.category === "other")
      .map((e) => ({ e, sim: similarity(c.content, e.content) }))
      .sort((a, b) => b.sim - a.sim);
    const best = matches[0];
    if (best && best.sim >= SIM_THRESHOLD) {
      // 合并：取更长/更完整的描述，仅在确有变化时更新
      const merged = c.content.length >= best.e.content.length ? c.content : best.e.content;
      if (merged !== best.e.content) {
        result.push({ kind: "update", id: best.e.id, content: merged });
      }
    } else {
      result.push({ kind: "create", candidate: c });
    }
  }
  return result;
}

async function updateProfiles(conversationId: string): Promise<void> {
  const conversation = readConversation(conversationId);
  if (!conversation) return;
  const completed = conversation.messages.filter(
    (m) => m.status === "completed" && m.content.trim()
  );
  if (completed.length < MIN_MESSAGES) return;

  // 节流：自上次提取后新增消息不足 DELTA 则跳过
  const lastId = lastProfiledId.get(conversationId);
  if (lastId) {
    const idx = completed.findIndex((m) => m.id === lastId);
    const afterCount = idx >= 0 ? completed.length - 1 - idx : completed.length;
    if (afterCount < PROFILE_DELTA) return;
  }
  const lastMsg = completed[completed.length - 1];
  lastProfiledId.set(conversationId, lastMsg.id);

  const material = completed
    .slice(-MATERIAL_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  const existing = listMemoryItems().filter(
    (i) => i.category === "profile" || i.category === "preference"
  );
  const existingView = existing.map((i) => ({
    id: i.id,
    category: i.category,
    content: i.content,
  }));

  let raw: string | undefined;
  try {
    const response = await getClient().chat.completions.create({
      model: resolveModel(process.env.DEEPSEEK_MODEL),
      messages: [
        { role: "system", content: PROFILE_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({ existingProfiles: existingView, recentConversation: material }),
        },
      ],
      temperature: 0.1,
      max_tokens: 800,
    });
    raw = response.choices[0]?.message?.content?.trim();
  } catch (error) {
    console.warn("Profile LLM call failed:", error instanceof Error ? error.message : error);
    return;
  }
  if (!raw) return;

  const candidates = parseProfileCandidates(raw);
  if (candidates.length === 0) return;

  const mutations = planProfileMutations(candidates, listMemoryItems());
  for (const m of mutations) {
    if (m.kind === "create") {
      // 自动提取只生成 suggested 候选，默认不启用，等待用户确认（符合 MEMORY_DESIGN Phase 4）
      createMemoryItem({
        content: m.candidate.content,
        category: m.candidate.category,
        source: "suggested",
        enabled: false,
        sourceConversationId: conversationId,
        sourceMessageId: lastMsg.id,
      });
    } else {
      updateMemoryItem(m.id, { content: m.content });
    }
  }
}

// 串行队列触发，失败仅告警、不阻断对话
export function scheduleProfileExtraction(conversationId: string): void {
  queue = queue
    .then(() => updateProfiles(conversationId))
    .catch((error) =>
      console.warn("Profile extraction failed:", error instanceof Error ? error.message : error)
    );
}
