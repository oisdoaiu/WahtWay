// 硬编码 Skill 定义 — V0.1 只有这一个 Skill
// 后期改为从 JSON 文件 / 数据库加载

import { Skill } from "../types";

export const studyPlanSkill: Skill = {
  id: "daily-study-plan",
  name: "每日学习计划",
  description: "根据学科、可用时间和学习重点，生成一份详细的每日学习计划",
  systemPrompt: `你是一个专业的学习规划师，擅长帮助大学生制定高效的学习计划。
你需要根据用户输入的条件，生成一份详细、可执行的每日学习计划。

## 计划要求
1. 按时间段划分（每个时间段 30-60 分钟）
2. 每个时间段明确学习内容和目标
3. 包含适当的休息时间（每 45-60 分钟休息 5-10 分钟）
4. 学习内容要具体，不要泛泛而谈
5. 在计划末尾加上一条学习小技巧

## 输出格式
用 Markdown 格式输出，包含：
- ## 今日学习概览（一句话总结）
- ## 详细时间表（表格）
- ## 学习小贴士

请严格按照以上格式输出。`,

  input: {
    type: "object",
    properties: {
      subject: { type: "string", description: "学科名称，如 高等数学" },
      availableHours: { type: "string", description: "可用学习时长，如 3小时" },
      focusAreas: { type: "string", description: "重点学习的内容，如 定积分计算" },
    },
    required: ["subject"],
  },

  output: {
    type: "object",
    properties: {
      plan: { type: "string", description: "Markdown 格式的学习计划" },
    },
  },

  requiredTools: [],
};

// V0.1 所有已注册的 Skill
export const registeredSkills: Skill[] = [studyPlanSkill];
