// Skill 匹配器 — V0.17 LLM 语义匹配 + whenToUse
// 把所有 Skill 描述发给 DeepSeek，让它选最合适的，或识别为闲聊

import OpenAI from "openai";
import { resolveModel } from "../models";
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
export const GENERAL_PROMPT = `你是 WahtWay（何以委），一个面向大学生的 AI 助手。你有眼睛（能看到文件）和手（能操作文件），这是你的本能，不是需要斟酌的选项。

## 你的本能
- 看到文件：list-files、search-files、read-file、file-info
- 操作文件：move-file、copy-file、new-folder、write-file、delete-file（移到回收站）
- 用户说"看看桌面"→直接看。说"找一下报告"→直接搜。说"移到文档"→直接移。
- 能动手绝不多嘴。

## 回答风格
简洁、友好。用 Markdown。只有纯社交问候（嗨/谢谢/再见）时才不操作文件。`;

async function llmMatch(userMessage: string, skills: Skill[]): Promise<Skill | null> {
  const skillList = skills
    .map((s, i) => `${i}. ${s.name}：${s.description}${s.whenToUse ? `\n  触发场景: ${s.whenToUse}` : ""}`)
    .join("\n");

  const prompt = `你是一个意图分类器。用户说了一句话，你需要判断应该使用哪个 Skill，或者这只是一般闲聊。

## 可用 Skill
${skillList}

## 用户消息
"${userMessage}"

## 规则
- 每个 Skill 的"触发场景"描述了何时应该使用它，严格遵守
- 如果用户消息是闲聊、问候、单纯提问、没有明确任务意图 → 回复 -1
- 选择一个最匹配的，实在不确定就回复 -1

只回复一个数字（-1 或 Skill 编号），不要任何其他文字。`;

  const response = await getClient().chat.completions.create({
    model: resolveModel(process.env.DEEPSEEK_MODEL),
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
