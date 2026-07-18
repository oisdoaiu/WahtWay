import { JSONSchema, JSONSchemaProperty, Skill } from "../types";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SCHEMA_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,79}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

const MAX_JSON_BYTES = 256 * 1024;
const MAX_KEYWORDS = 30;
const MAX_TAGS = 12;

const allowedTools = new Set(
  (process.env.ALLOWED_SKILL_TOOLS || "")
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean)
);

export class SkillValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillValidationError";
  }
}

function assertObject(value: unknown, fieldName: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SkillValidationError(`${fieldName} 必须是对象`);
  }
}

function stringField(source: Record<string, unknown>, key: string, min: number, max: number): string {
  const value = source[key];
  if (typeof value !== "string") {
    throw new SkillValidationError(`${key} 必须是字符串`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new SkillValidationError(`${key} 长度必须在 ${min}-${max} 个字符之间`);
  }
  return trimmed;
}

function optionalString(source: Record<string, unknown>, key: string, max: number): string | undefined {
  const value = source[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new SkillValidationError(`${key} 必须是字符串`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new SkillValidationError(`${key} 不能超过 ${max} 个字符`);
  }
  return trimmed || undefined;
}

function normalizeStringArray(value: unknown, fieldName: string, maxItems: number, maxLength: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new SkillValidationError(`${fieldName} 必须是字符串数组`);
  }

  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new SkillValidationError(`${fieldName} 只能包含字符串`);
    }
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed.length > maxLength) {
      throw new SkillValidationError(`${fieldName} 中的单项不能超过 ${maxLength} 个字符`);
    }
    if (!result.includes(trimmed)) result.push(trimmed);
  }

  if (result.length > maxItems) {
    throw new SkillValidationError(`${fieldName} 最多只能有 ${maxItems} 项`);
  }

  return result;
}

function sanitizeSchemaProperty(value: unknown, fieldName: string): JSONSchemaProperty {
  assertObject(value, fieldName);
  return {
    type: stringField(value, "type", 1, 40),
    description: stringField(value, "description", 1, 300),
    enum: value.enum ? normalizeStringArray(value.enum, `${fieldName}.enum`, 50, 80) : undefined,
  };
}

function sanitizeSchema(value: unknown, fieldName: string): JSONSchema {
  assertObject(value, fieldName);
  const type = stringField(value, "type", 1, 40);
  const propertiesValue = value.properties;
  const properties: Record<string, JSONSchemaProperty> = {};

  if (propertiesValue !== undefined) {
    assertObject(propertiesValue, `${fieldName}.properties`);
    const entries = Object.entries(propertiesValue);
    if (entries.length > 50) {
      throw new SkillValidationError(`${fieldName}.properties 最多只能有 50 项`);
    }
    for (const [key, propertyValue] of entries) {
      if (!SCHEMA_KEY_PATTERN.test(key)) {
        throw new SkillValidationError(`${fieldName}.properties 的字段名只能包含字母、数字、下划线和连字符`);
      }
      properties[key] = sanitizeSchemaProperty(propertyValue, `${fieldName}.properties.${key}`);
    }
  }

  return {
    type,
    properties: Object.keys(properties).length > 0 ? properties : undefined,
    required: value.required ? normalizeStringArray(value.required, `${fieldName}.required`, 50, 80) : undefined,
  };
}

export function sanitizeSkillManifest(value: unknown): Skill {
  assertObject(value, "manifest");
  const id = stringField(value, "id", 3, 64);
  if (!ID_PATTERN.test(id)) {
    throw new SkillValidationError("id 必须是 kebab-case，只能包含小写字母、数字和连字符");
  }

  const requiredTools = normalizeStringArray(value.requiredTools, "requiredTools", 20, 80);
  const declaredAllowedTools = normalizeStringArray(value.allowedTools, "allowedTools", 20, 80);
  const forbiddenTool = [...requiredTools, ...declaredAllowedTools].find((tool) => !allowedTools.has(tool));
  if (forbiddenTool) {
    throw new SkillValidationError(`Skill 包含未允许的工具: ${forbiddenTool}`);
  }

  const skill: Skill = {
    id,
    name: stringField(value, "name", 1, 80),
    description: stringField(value, "description", 1, 500),
    systemPrompt: stringField(value, "systemPrompt", 20, 20000),
    input: sanitizeSchema(value.input, "input"),
    output: sanitizeSchema(value.output, "output"),
    requiredTools,
    allowedTools: declaredAllowedTools,
    whenToUse: optionalString(value, "whenToUse", 2000),
    keywords: normalizeStringArray(value.keywords, "keywords", MAX_KEYWORDS, 40),
  };

  const jsonBytes = Buffer.byteLength(JSON.stringify(skill), "utf-8");
  if (jsonBytes > MAX_JSON_BYTES) {
    throw new SkillValidationError("Skill JSON 不能超过 256KB");
  }

  return skill;
}

export function sanitizeVersion(value: unknown): string {
  if (value === undefined || value === null || value === "") return "1.0.0";
  if (typeof value !== "string") {
    throw new SkillValidationError("version 必须是字符串");
  }
  const version = value.trim();
  if (!VERSION_PATTERN.test(version)) {
    throw new SkillValidationError("version 必须符合 semver 格式，例如 1.0.0");
  }
  return version;
}

export function sanitizeChangelog(value: unknown): string | undefined {
  return optionalString({ changelog: value }, "changelog", 1000);
}

export function sanitizeTags(value: unknown): string[] {
  return normalizeStringArray(value, "tags", MAX_TAGS, 40);
}

export function sanitizeOptionalText(value: unknown, fieldName: string, max: number): string | undefined {
  return optionalString({ [fieldName]: value }, fieldName, max);
}

export function normalizeSkillId(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
