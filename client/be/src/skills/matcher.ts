// Skill 匹配器 — V0.8 LLM 语义匹配 + 闲聊识别
// 把所有 Skill 描述发给 DeepSeek，让它选最合适的，或识别为闲聊

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

/** 通用闲聊 System Prompt — 不用任何 Skill */
export const GENERAL_PROMPT = `你是 WahtWay（何以委），一个面向大学生的 AI 助手。
你可以闲聊、回答问题、提供建议，也可以帮助用户管理本地文件。
回答要简洁、友好、有温度。用 Markdown 格式化输出。`;

async function llmMatch(userMessage: string, skills: Skill[]): Promise<Skill | null> {
  const skillList = skills
    .map((s, i) => `${i}. ${s.name}：${s.description}`)
    .join("\n");

  const prompt = `你是一个意图分类器。用户说了一句话，你需要判断应该使用哪个 Skill，或者这只是一般闲聊。

## 可用 Skill
${skillList}

## 用户消息
"${userMessage}"

## 规则
- 如果用户消息是闲聊、问候、单纯提问、没有明确任务意图 → 回复 -1
- 如果用户想做菜/食谱/烹饪相关，选食谱类 Skill
- 如果用户想学习/复习/制定计划，选学习类 Skill
- 如果用户想分析代码/debug，选代码类 Skill
- 如果用户想操作/查看/搜索/整理本地文件，选文件管理类 Skill
- 选择一个最匹配的，实在不确定就回复 -1

只回复一个数字（-1 或 Skill 编号），不要任何其他文字。`;

  const response = await getClient().chat.completions.create({
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 5,
    stream: false,
  });

  const raw = response.choices[0]?.message?.content?.trim() || "-1";
  const index = parseInt(raw, 10);

  if (index === -1 || isNaN(index) || index < 0 || index >= skills.length) {
    console.log(`💬 LLM 匹配: "${userMessage}" → 闲聊模式`);
    return null;
  }

  const matched = skills[index];
  console.log(`🤖 LLM 匹配: "${userMessage}" → ${matched.name}`);
  return matched;
}

export async function matchSkillByKeywords(
  userMessage: string,
  skills: Skill[]
): Promise<Skill | null> {
  if (skills.length === 0) return null;
  return llmMatch(userMessage, skills);
}
