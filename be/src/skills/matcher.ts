// Skill 关键词匹配器 — V0.3
// 简单、快速、零成本。后期可升级为 Embedding 语义匹配。

import { Skill } from "../types";

/**
 * 根据用户消息匹配最合适的 Skill
 * 返回得分最高的 Skill，全部 0 分则返回第一个（兜底）
 */
export function matchSkillByKeywords(
  userMessage: string,
  skills: Skill[]
): Skill | null {
  if (skills.length === 0) return null;
  if (skills.length === 1) return skills[0];

  const lowerMsg = userMessage.toLowerCase();

  const scored = skills.map((skill) => {
    const keywords = skill.keywords || [];
    let score = 0;

    for (const kw of keywords) {
      if (lowerMsg.includes(kw.toLowerCase())) {
        score += 1;
      }
    }

    return { skill, score };
  });

  // 按得分降序
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];

  // 打印匹配日志
  if (best.score > 0) {
    console.log(
      `🎯 匹配 Skill: "${best.skill.name}" (得分: ${best.score})`
    );
  } else {
    console.log(
      `🎯 无关键词命中，使用默认 Skill: "${best.skill.name}"`
    );
  }

  return best.skill;
}
