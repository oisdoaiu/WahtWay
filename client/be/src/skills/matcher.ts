// Skill 匹配器 — V0.8 LLM 语义匹配
// 把所有 Skill 描述发给 DeepSeek，让它选最合适的

import OpenAI from "openai";
import { Skill } from "../types";

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

/**
 * LLM 语义匹配：把用户消息 + 所有 Skill 描述发给 LLM，让它选一个
 */
async function llmMatch(userMessage: string, skills: Skill[]): Promise<Skill> {
  const skillList = skills
    .map((s, i) => `${i}. ${s.name}：${s.description}`)
    .join("\n");

  const prompt = `你是一个意图分类器。用户说了一句话，你需要从以下 Skill 中选择最匹配的一个。

## 可用 Skill
${skillList}

## 用户消息
"${userMessage}"

## 规则
- 选择最能满足用户意图的 Skill
- 如果用户想做菜/食谱/烹饪相关，选食谱类 Skill
- 如果用户想学习/复习/制定计划，选学习类 Skill
- 如果用户想分析代码/debug，选代码类 Skill
- 如果没有明显匹配的，选最通用的那个

只回复一个数字（Skill 编号），不要任何其他文字。`;

  const response = await getClient().chat.completions.create({
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 5,
    stream: false,
  });

  const raw = response.choices[0]?.message?.content?.trim() || "0";
  const index = parseInt(raw, 10);
  const matched = skills[isNaN(index) ? 0 : Math.min(index, skills.length - 1)];

  console.log(`🤖 LLM 匹配: "${userMessage}" → ${matched.name} (index ${index})`);
  return matched;
}

/**
 * 根据用户消息匹配最合适的 Skill
 * 1 个 Skill → 直接返回
 * 多个 Skill → LLM 语义匹配
 */
export async function matchSkillByKeywords(
  userMessage: string,
  skills: Skill[]
): Promise<Skill | null> {
  if (skills.length === 0) return null;
  if (skills.length === 1) return skills[0];

  return llmMatch(userMessage, skills);
}
