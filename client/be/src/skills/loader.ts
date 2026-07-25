// Skill 加载器 — V0.3
// 从 be/data/skills/ 目录读取所有 JSON 文件，解析为 Skill 对象

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { Skill } from "../types";
import {
  deleteSkillLearning,
  getActiveSkillOverride,
  resetActiveSkillVersion,
} from "./learning-store";

const BUILTIN_SKILL_IDS = new Set(["daily-study-plan", "code-explain"]);
const SAFE_SKILL_ID = /^[\p{L}\p{N}][\p{L}\p{N}-]{0,79}$/u;

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
    console.warn(`[loader] skills dir not found: ${getSkillsDir()}`);
    return [];
  }

  const files = fs
    .readdirSync(getSkillsDir())
    .filter((f) => f.endsWith(".json"));

  if (files.length === 0) {
    console.warn("[loader] no skill files found");
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
      console.log(`[loader] loaded: ${parsed.name}`);
    } catch (err: any) {
      console.error(`[loader] failed to parse ${file}: ${err.message}`);
    }
  }

  console.log(`✅ 共加载 ${skills.length} 个 Skill\n`);
  return skills;
}

/**
 * 全局 Skill 注册表，服务启动时填充
 */
export let registeredSkills: Skill[] = [];

export function assertValidSkillId(skillId: string): void {
  if (!SAFE_SKILL_ID.test(skillId)) throw new Error(`无效的 Skill ID: ${skillId}`);
}

function skillFilePath(skillId: string): string {
  assertValidSkillId(skillId);
  const root = path.resolve(getSkillsDir());
  const filePath = path.resolve(root, `${skillId}.json`);
  if (path.dirname(filePath) !== root) throw new Error("Skill 路径超出存储目录");
  return filePath;
}

export function readPersistedSkill(skillId: string): Skill | null {
  const filePath = skillFilePath(skillId);
  if (!fs.existsSync(filePath)) return null;
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Skill;
  const missing = REQUIRED_FIELDS.filter((field) => !(field in parsed));
  if (missing.length > 0) throw new Error(`Skill 缺少必填字段: ${missing.join(", ")}`);
  return parsed;
}

function writeSkillAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf-8");
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

/**
 * 删除 Skill JSON 文件并重载注册表
 */
export function deleteSkill(skillId: string): void {
  const filePath = skillFilePath(skillId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Skill 文件不存在: ${skillId}`);
  }
  fs.unlinkSync(filePath);
  deleteSkillLearning(skillId);
  console.log(`[loader] deleted: ${skillId}`);
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
export function saveSkill(skill: Skill, options: { resetLearning?: boolean } = {}): void {
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
  const filePath = skillFilePath(skill.id);
  const { version: _version, origin: _origin, ...persistedSkill } = skill;
  writeSkillAtomic(filePath, persistedSkill);
  if (options.resetLearning !== false) resetActiveSkillVersion(skill.id);
  console.log(`[loader] saved: ${skill.name} → ${filePath}`);

  // 4. 重载注册表
  registeredSkills = loadSkills();
}
