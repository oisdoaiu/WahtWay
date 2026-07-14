// Skill 加载器（服务端）
import * as fs from "fs";
import * as path from "path";
import { Skill } from "../types";

const SKILLS_DIR = path.resolve(__dirname, "../../data/skills");

export function loadSkills(): Skill[] {
  if (!fs.existsSync(SKILLS_DIR)) return [];

  const skills: Skill[] = [];
  for (const file of fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith(".json"))) {
    try {
      const raw = fs.readFileSync(path.join(SKILLS_DIR, file), "utf-8");
      skills.push(JSON.parse(raw));
    } catch (err: any) {
      console.error(`❌ ${file}: ${err.message}`);
    }
  }
  console.log(`📦 Skill Hub: ${skills.length} 个 Skill 已加载`);
  return skills;
}

export let registeredSkills: Skill[] = [];

export function initSkills(): void {
  registeredSkills = loadSkills();
}
