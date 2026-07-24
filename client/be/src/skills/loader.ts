// Skill 加载器 — V0.3
// 从 be/data/skills/ 目录读取所有 JSON 文件，解析为 Skill 对象

import * as fs from "fs";
import * as path from "path";
import { Skill } from "../types";
import {
  deleteSkillLearning,
  getActiveSkillOverride,
  resetActiveSkillVersion,
} from "./learning-store";

const BUILTIN_SKILL_IDS = new Set(["daily-study-plan", "code-explain"]);

// 动态计算 skills 路径（兼容 ts-node 开发 / esbuild 编译 / Electron 三种模式）
export function getSkillsDir(): string {
  const candidates = [
    path.join(process.cwd(), "data", "skills"),           // Electron / npm start
    path.resolve(__dirname, "../data/skills"),             // esbuild 编译 (dist/ → ../data/skills)
    path.resolve(__dirname, "../../data/skills"),          // ts-node 开发 (src/skills/ → ../../data/skills)
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0]; // 返回默认路径（Electron 模式优先）
}

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
  if (!fs.existsSync(getSkillsDir())) {
    console.warn(`⚠️ Skill 目录不存在: ${getSkillsDir()}`);
    return [];
  }

  const files = fs
    .readdirSync(getSkillsDir())
    .filter((f) => f.endsWith(".json"));

  if (files.length === 0) {
    console.warn("⚠️ 没有找到任何 Skill 文件");
    return [];
  }

  const skills: Skill[] = [];

  for (const file of files) {
    const filePath = path.join(getSkillsDir(), file);

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

      const baseSkill = parsed as Skill;
      const activeOverride = getActiveSkillOverride(baseSkill.id);
      skills.push(activeOverride || {
        ...baseSkill,
        version: 1,
        origin: BUILTIN_SKILL_IDS.has(baseSkill.id) ? "builtin" : "custom",
      });
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
 * 删除 Skill JSON 文件并重载注册表
 */
export function deleteSkill(skillId: string): void {
  const filePath = path.join(getSkillsDir(), `${skillId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Skill 文件不存在: ${skillId}`);
  }
  fs.unlinkSync(filePath);
  deleteSkillLearning(skillId);
  console.log(`🗑️ 已删除 Skill: ${skillId}`);
  registeredSkills = loadSkills();
}

/**
 * 初始化：加载所有 Skill 并填充注册表
 */
export function initSkills(): void {
  registeredSkills = loadSkills();
}

/**
 * 保存新 Skill 到 JSON 文件并重载注册表
 */
export function saveSkill(skill: Skill): void {
  // 1. 校验必填字段
  const missing = REQUIRED_FIELDS.filter((f) => !(f in skill));
  if (missing.length > 0) {
    throw new Error(`Skill 缺少必填字段: ${missing.join(", ")}`);
  }

  // 2. 确保目录存在
  if (!fs.existsSync(getSkillsDir())) {
    fs.mkdirSync(getSkillsDir(), { recursive: true });
  }

  // 3. 写入文件
  const filePath = path.join(getSkillsDir(), `${skill.id}.json`);
  const { version: _version, origin: _origin, ...persistedSkill } = skill;
  fs.writeFileSync(filePath, JSON.stringify(persistedSkill, null, 2), "utf-8");
  resetActiveSkillVersion(skill.id);
  console.log(`💾 已保存 Skill: ${skill.name} → ${filePath}`);

  // 4. 重载注册表
  registeredSkills = loadSkills();
}
