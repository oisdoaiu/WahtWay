// GET /api/skills — 返回已注册的 Skill 列表（脱敏，不含 systemPrompt）

import { Router, Request, Response } from "express";
import { registeredSkills } from "../skills/study-plan";

const router = Router();

router.get("/", (_req: Request, res: Response) => {
  // 脱敏：只暴露展示字段，不泄露 systemPrompt
  const skills = registeredSkills.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    input: s.input,
    output: s.output,
    requiredTools: s.requiredTools,
  }));

  res.json({ skills });
});

export default router;
