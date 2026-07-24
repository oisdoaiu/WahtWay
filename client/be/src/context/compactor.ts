// V0.21 对话上下文压缩 — 无感滚动压缩核心
//
// 设计：
// - 每次对话都压，但用户无感：LLM 永远只看到 [summary(长期记忆) + 最近K轮原文]
// - summary 常驻在对话 JSON 的 summary 字段，随对话增量更新（每 M 轮合并一次）
// - 平时零额外 LLM 调用；合并失败降级保留旧 summary，不阻断对话
// - COMPACT_ENABLED=false 时完全等价于"全量 history"

import OpenAI from "openai";
import { resolveModel } from "../models";
import { logger } from "../logger";

/** 注入给 LLM 的摘要前缀，便于模型区分"记忆"与"当前对话" */
export const SUMMARY_PREFIX = "[早期对话摘要 · 以下为长期记忆，非当前输入]\n";

export interface CompactConfig {
  enabled: boolean;
  mode: "rolling" | "threshold"; // rolling=每次都压(无感) / threshold=短对话不压、超阈值才压
  recentTurns: number; // 保留最近多少条原文（message 数，非轮数）
  summaryEvery: number; // 窗口外每累积多少条，增量合并一次 summary
}

export function getCompactConfig(): CompactConfig {
  const modeRaw = (process.env.COMPACT_MODE || "rolling").toLowerCase();
  return {
    enabled: (process.env.COMPACT_ENABLED ?? "true").toLowerCase() !== "false",
    mode: modeRaw === "threshold" ? "threshold" : "rolling",
    recentTurns: Math.max(2, Number(process.env.COMPACT_RECENT_TURNS || 6)),
    summaryEvery: Math.max(2, Number(process.env.COMPACT_SUMMARY_EVERY || 6)),
  };
}

/**
 * 粗略 token 估算（不调用 tokenizer，足够做阈值判断）：
 * 中文约 1.5 token/字，其他字符约 0.25 token/字。
 */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[一-鿿]/g) || []).length;
  const others = text.length - cjk;
  return Math.ceil(cjk * 1.5 + others * 0.25);
}

export function estimateMessagesTokens(messages: { role: string; content: string }[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content || ""), 0);
}

export interface CompactResult {
  /** 喂给 LLM 的最终 history：可能含 1 条 system 摘要 + 最近原文 */
  history: { role: string; content: string }[];
  /** 是否需要在本次触发一次 summary 增量合并 */
  needsUpdate: boolean;
  /** 需要合并进 summary 的那批旧消息（窗口外最近 M 条） */
  updateFrom: { role: string; content: string }[];
  /** 窗口外消息总数，便于调试 */
  beyondCount: number;
}

/**
 * 根据全量 messages + 已有 summary，生成喂给 LLM 的压缩 history。
 * 纯同步计算，不调 LLM。
 *
 * - rolling 模式：每次都压，恒返回 [summary + 最近 recentTurns 条]。
 * - threshold 模式：短对话（<= recentTurns 条）直接全量透传、不注入摘要、不压缩；
 *   超过后才启用 summary + 最近窗口（救火式，避免影响短对话体验）。
 */
export function buildCompactHistory(
  messages: { role: string; content: string }[],
  summary: string,
  cfg: CompactConfig
): CompactResult {
  // threshold 模式：短对话不压，完整透传
  if (cfg.mode === "threshold" && messages.length <= cfg.recentTurns) {
    return { history: messages, needsUpdate: false, updateFrom: [], beyondCount: 0 };
  }

  const recent = messages.slice(-cfg.recentTurns);
  const beyond = messages.slice(0, Math.max(0, messages.length - cfg.recentTurns));
  const beyondCount = beyond.length;

  const history: { role: string; content: string }[] = [
    ...(summary && summary.trim() ? [{ role: "system", content: SUMMARY_PREFIX + summary }] : []),
    ...recent,
  ];

  // 每累积 summaryEvery 条窗口外消息，触发一次增量合并
  const needsUpdate = beyondCount > 0 && beyondCount % cfg.summaryEvery === 0;
  const updateFrom = needsUpdate ? beyond.slice(-cfg.summaryEvery) : [];

  return { history, needsUpdate, updateFrom, beyondCount };
}

function getAIClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  });
}

/**
 * 把旧 summary + 一批新消息合并为新的 summary。
 * 失败时返回旧 summary（降级），不抛异常。
 */
export async function mergeSummary(
  traceId: string,
  oldSummary: string,
  batch: { role: string; content: string }[]
): Promise<string> {
  const log = logger(traceId || "no-trace", "compactor");
  try {
    if (!batch || batch.length === 0) return oldSummary;
    const batchText = batch.map((m) => `${m.role}: ${m.content}`).join("\n");
    const prompt = `你是一个对话压缩器。下面是一段对话的【已有摘要】和【需要合并进摘要的新对话片段】。

要求：
1. 输出更新后的【合并摘要】。
2. 必须保留：用户意图与偏好、关键决策、已完成/未完成的事项、重要结论、待办清单、关键文件路径等长期有用的信息。
3. 丢弃：冗余细节、重复的工具调用输出、与主线无关的闲聊、临时性的中间结果。
4. 中文，简洁，长度控制在(已有摘要长度 + 新片段长度)的 1/3 以内。
5. 若已有摘要为空，则直接对新片段做摘要。

【已有摘要】
${oldSummary && oldSummary.trim() ? oldSummary : "(空)"}

【新对话片段】
${batchText}

【合并摘要】`;

    const resp = await getAIClient().chat.completions.create({
      model: resolveModel(process.env.DEEPSEEK_MODEL),
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
      temperature: 0.2,
    });
    const newSummary = resp.choices[0]?.message?.content?.trim();
    if (!newSummary) return oldSummary;
    log.info("merge_ok", { oldLen: oldSummary.length, newLen: newSummary.length, batch: batch.length });
    return newSummary;
  } catch (err: any) {
    log.warn("merge_fail", { error: err?.message || String(err) });
    return oldSummary; // 降级：保留旧 summary，对话不中断
  }
}
