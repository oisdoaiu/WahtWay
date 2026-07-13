// Skill 加载器 — V0.3
// 从 be/data/skills/ 目录读取所有 JSON 文件，解析为 Skill 对象

import * as fs from "fs";
import * as path from "path";
import { Skill } from "../types";

const SKILLS_DIR = path.resolve(__dirname, "../../data/skills");

const REQUIRED_FIELDS: (keyof Skill)[] = [
  "id",
  "name",
  "description",
  "systemPrompt",
  "input",
  "output",
];

/**
 * 加载所有 Skill JSON 文件
 */
export function loadSkills(): Skill[] {
  if (!fs.existsSync(SKILLS_DIR)) {
    console.warn(`⚠️ Skill 目录不存在: ${SKILLS_DIR}`);
    return [];
  }

  const files = fs
    .readdirSync(SKILLS_DIR)
    .filter((f) => f.endsWith(".json"));

  if (files.length === 0) {
    console.warn("⚠️ 没有找到任何 Skill 文件");
    return [];
  }

  const skills: Skill[] = [];

  for (const file of files) {
    const filePath = path.join(SKILLS_DIR, file);

    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);

      // 校验必填字段
      const missing = REQUIRED_FIELDS.filter((f) => !(f in parsed));
      if (missing.length > 0) {
        console.error(
          `❌ Skill 文件 ${file} 缺少字段: ${missing.join(", ")}`
        );
        continue;
      }

      skills.push(parsed as Skill);
      console.log(`📦 已加载 Skill: ${parsed.name} (${parsed.id})`);
    } catch (err: any) {
      console.error(`❌ 解析 Skill 文件 ${file} 失败: ${err.message}`);
    }
  }

  console.log(`✅ 共加载 ${skills.length} 个 Skill\n`);
  return skills;
}

/**
 * 全局 Skill 注册表，服务启动时填充
 */
export let registeredSkills: Skill[] = [];

/**
 * 初始化：加载所有 Skill 并填充注册表
 */
export function initSkills(): void {
  registeredSkills = loadSkills();
}
