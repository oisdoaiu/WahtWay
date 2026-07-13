// Agent 核心 — V0.1 最简版本
// 职责：接收用户消息 → 匹配 Skill → 组装 Prompt → 调用 LLM → 返回结果

import OpenAI from "openai";
import { Skill, AgentResult, TokenUsage } from "./types";
import { registeredSkills } from "./skills/study-plan";

// 初始化 DeepSeek 客户端（OpenAI 兼容格式）
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
});

const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

/**
 * V0.1 最简匹配：只有一个 Skill，直接返回
 * 后期改为：把所有 Skill 描述发给 LLM，让它选
 */
function matchSkill(userMessage: string): Skill | null {
  // V0.1: 只有 1 个 Skill，直接返回即可
  if (registeredSkills.length === 1) {
    return registeredSkills[0];
  }
  // V0.3+: LLM 意图匹配
  return registeredSkills[0];
}

/**
 * 执行 Skill：组装 Prompt → 调 LLM → 返回结果
 */
async function executeSkill(
  skill: Skill,
  userMessage: string
): Promise<AgentResult> {
  const systemPrompt = skill.systemPrompt;

  console.log(`🧠 已匹配 Skill: ${skill.name}`);
  console.log("🚀 正在调用 LLM……\n");

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: 0.7,
    max_tokens: 2048,
    stream: false,
  });

  const choice = response.choices[0];
  const output = choice?.message?.content || "（未获取到回复）";
  const usage = response.usage;

  return {
    skillName: skill.name,
    skillId: skill.id,
    output,
    tokenUsage: {
      promptTokens: usage?.prompt_tokens || 0,
      completionTokens: usage?.completion_tokens || 0,
      totalTokens: usage?.total_tokens || 0,
    },
  };
}

/**
 * 流式执行 Skill：组装 Prompt → 调 LLM（stream: true）→ 逐 token 返回
 * 返回 AsyncGenerator，yield 每个 delta token 和最终 done 事件
 */
export async function* executeSkillStream(
  skill: Skill,
  userMessage: string
): AsyncGenerator<StreamEvent> {
  const systemPrompt = skill.systemPrompt;

  const stream = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: 0.7,
    max_tokens: 2048,
    stream: true,
  });

  let fullContent = "";
  let usage: TokenUsage | null = null;

  // 在流开始前，先推 Skill 匹配信息
  yield {
    type: "skill_matched",
    data: { skillName: skill.name, skillId: skill.id },
  };

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      fullContent += delta;
      yield { type: "delta", data: delta };
    }

    // 最后一个 chunk 可能带 usage（DeepSeek 特性）
    if (chunk.usage) {
      usage = {
        promptTokens: chunk.usage.prompt_tokens || 0,
        completionTokens: chunk.usage.completion_tokens || 0,
        totalTokens: chunk.usage.total_tokens || 0,
      };
    }
  }

  // 流结束
  yield {
    type: "done",
    data: {
      fullContent,
      tokenUsage: usage,
    },
  };
}

export interface StreamEvent {
  type: "skill_matched" | "delta" | "done";
  data: unknown;
}

/**
 * Agent 主入口（非流式，V0.1 保留兼容）
 */
export async function runAgent(userMessage: string): Promise<AgentResult> {
  const skill = matchSkill(userMessage);
  if (!skill) {
    throw new Error("未找到合适的 Skill，请尝试更明确的描述。");
  }
  return executeSkill(skill, userMessage);
}

/**
 * Agent 流式入口 — V0.2 新增
 */
export function runAgentStream(
  userMessage: string
): AsyncGenerator<StreamEvent> {
  const skill = matchSkill(userMessage);
  if (!skill) {
    throw new Error("未找到合适的 Skill，请尝试更明确的描述。");
  }
  return executeSkillStream(skill, userMessage);
}

export { matchSkill };
