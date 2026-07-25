import { createHash } from "crypto";
import { listPublicMcpServers } from "../mcp/runtime";
import { McpToolPermission, McpToolRisk, PublicMcpServer } from "../mcp/types";
import { McpSkillBinding, Skill } from "../types";
import { getAllTools } from "../tools/registry";
import { getSkillDependencyHealth } from "./dependency-health";
import {
  appendSkillDependencyRepairAuditEvent,
  createSkillDependencyRepairAuditEvent,
} from "./dependency-repair-audit";
import { readPersistedSkill, saveSkill } from "./loader";
import { readLearningState } from "./learning-store";

export type SkillRepairPromptPolicy = "preserve" | "replace-exact";
export type SkillRepairCandidateMatch = "same-binding" | "same-tool" | "same-server" | "other";

export interface SkillRepairCandidate {
  serverId: string;
  serverName: string;
  toolName: string;
  registeredName: string;
  description: string;
  permission: Exclude<McpToolPermission, "disabled">;
  risk: McpToolRisk;
  match: SkillRepairCandidateMatch;
  recommended: boolean;
  toolListRevision: number;
  schemaCompatibility: "unknown";
}

export interface SkillRepairChange {
  field: "mcpBindings" | "allowedTools" | "requiredTools" | "systemPrompt";
  before: unknown;
  after: unknown;
}

export interface SkillBindingRepairRequest {
  expectedRevision: string;
  expectedBinding: McpSkillBinding;
  replacement: {
    serverId: string;
    toolName: string;
  };
  expectedToolListRevision: number;
  promptPolicy: SkillRepairPromptPolicy;
}

export interface SkillBindingRepairPreview {
  skillId: string;
  skillName: string;
  bindingIndex: number;
  expectedRevision: string;
  expectedToolListRevision: number;
  originalBinding: McpSkillBinding;
  replacementBinding: McpSkillBinding;
  candidate: SkillRepairCandidate;
  promptPolicy: SkillRepairPromptPolicy;
  promptReplacementCount: number;
  changes: SkillRepairChange[];
  warnings: string[];
}

interface SkillBindingRepairPlan extends SkillBindingRepairPreview {
  nextSkill: Skill;
}

export class SkillDependencyRepairError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "SkillDependencyRepairError";
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
}

function persistedManifest(skill: Skill): Omit<Skill, "version" | "origin"> {
  const { version: _version, origin: _origin, ...manifest } = skill;
  return manifest;
}

export function skillDependencyRevision(skill: Skill): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(persistedManifest(skill))), "utf-8")
    .digest("hex");
}

function bindingEquals(left: McpSkillBinding, right: McpSkillBinding): boolean {
  return left.serverId === right.serverId
    && left.toolName === right.toolName
    && left.registeredName === right.registeredName;
}

function validateBinding(value: unknown, field: string): McpSkillBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SkillDependencyRepairError("INVALID_BINDING", `${field} 无效`, 400);
  }
  const raw = value as Record<string, unknown>;
  const serverId = typeof raw.serverId === "string" ? raw.serverId.trim() : "";
  const toolName = typeof raw.toolName === "string" ? raw.toolName.trim() : "";
  const registeredName = typeof raw.registeredName === "string" ? raw.registeredName.trim() : "";
  if (!serverId || serverId.length > 80 || !toolName || toolName.length > 256 || !registeredName || registeredName.length > 128) {
    throw new SkillDependencyRepairError("INVALID_BINDING", `${field} 字段无效`, 400);
  }
  return { serverId, toolName, registeredName };
}

function validateIndex(skill: Skill, bindingIndex: number): McpSkillBinding {
  if (!Number.isInteger(bindingIndex) || bindingIndex < 0) {
    throw new SkillDependencyRepairError("INVALID_BINDING_INDEX", "binding index 无效", 400);
  }
  const binding = skill.mcpBindings?.[bindingIndex];
  if (!binding) throw new SkillDependencyRepairError("BINDING_NOT_FOUND", "MCP binding 不存在", 404);
  return validateBinding(binding, "当前 binding");
}

function loadRepairableSkill(skillId: string): Skill {
  let skill: Skill | null;
  try {
    skill = readPersistedSkill(skillId);
  } catch (error) {
    if (error instanceof SkillDependencyRepairError) throw error;
    throw new SkillDependencyRepairError(
      "INVALID_SKILL",
      error instanceof Error ? error.message : "Skill 无效",
      400
    );
  }
  if (!skill) throw new SkillDependencyRepairError("SKILL_NOT_FOUND", "Skill 不存在", 404);
  const learning = readLearningState(skillId);
  if (learning.activeVersion > 1) {
    throw new SkillDependencyRepairError(
      "ACTIVE_LEARNED_VERSION",
      `Skill 当前使用学习版本 v${learning.activeVersion}，请先恢复基础版本后再修复依赖`,
      409,
      { activeVersion: learning.activeVersion }
    );
  }
  return skill;
}

function registeredToolNames(): Set<string> {
  return new Set(getAllTools().map((tool) => tool.name));
}

function candidateMatch(binding: McpSkillBinding, serverId: string, toolName: string): SkillRepairCandidateMatch {
  if (serverId === binding.serverId && toolName === binding.toolName) return "same-binding";
  if (toolName === binding.toolName) return "same-tool";
  if (serverId === binding.serverId) return "same-server";
  return "other";
}

function candidateScore(candidate: SkillRepairCandidate): number {
  const matchScore = candidate.match === "same-binding" ? 400
    : candidate.match === "same-tool" ? 300
      : candidate.match === "same-server" ? 200 : 100;
  const riskScore = candidate.risk === "read" ? 20 : candidate.risk === "write" ? 10 : 0;
  return matchScore + riskScore;
}

export function buildSkillRepairCandidates(
  skill: Skill,
  bindingIndex: number,
  servers: PublicMcpServer[],
  toolNames: Iterable<string>
): SkillRepairCandidate[] {
  const binding = validateIndex(skill, bindingIndex);
  const registry = new Set(toolNames);
  const otherBindings = (skill.mcpBindings || []).filter((_item, index) => index !== bindingIndex);
  const bindingExcludedByWhitelist = Array.isArray(skill.allowedTools)
    && skill.allowedTools.length > 0
    && !skill.allowedTools.includes(binding.registeredName);
  const candidates: SkillRepairCandidate[] = [];

  for (const server of servers) {
    if (!server.enabled || server.status.state !== "running") continue;
    for (const tool of server.status.tools) {
      if (tool.permission === "disabled" || !registry.has(tool.registeredName)) continue;
      const exactBinding = bindingEquals(binding, {
        serverId: server.id,
        toolName: tool.name,
        registeredName: tool.registeredName,
      });
      if (exactBinding && !bindingExcludedByWhitelist) continue;
      if (otherBindings.some((item) => item.serverId === server.id && item.toolName === tool.name)) continue;
      if (otherBindings.some((item) => item.registeredName === tool.registeredName)) continue;
      const match = candidateMatch(binding, server.id, tool.name);
      candidates.push({
        serverId: server.id,
        serverName: server.name,
        toolName: tool.name,
        registeredName: tool.registeredName,
        description: tool.description,
        permission: tool.permission === "auto" ? "auto" : "confirm",
        risk: tool.risk,
        match,
        recommended: match === "same-binding",
        toolListRevision: server.status.toolListRevision,
        schemaCompatibility: "unknown",
      });
    }
  }

  return candidates
    .sort((left, right) => candidateScore(right) - candidateScore(left)
      || left.serverName.localeCompare(right.serverName)
      || left.toolName.localeCompare(right.toolName))
    .slice(0, 200);
}

export function getSkillBindingRepairCandidates(skillId: string, bindingIndex: number) {
  const skill = loadRepairableSkill(skillId);
  const binding = validateIndex(skill, bindingIndex);
  const servers = listPublicMcpServers();
  const toolNames = registeredToolNames();
  const health = getSkillDependencyHealth(skill);
  const bindingHealth = health.bindings[bindingIndex];
  return {
    skillId: skill.id,
    skillName: skill.name,
    bindingIndex,
    expectedRevision: skillDependencyRevision(skill),
    expectedBinding: binding,
    issues: health.issues.filter((issue) =>
      issue.serverId === binding.serverId && (!issue.toolName || issue.toolName === binding.toolName)
    ),
    bindingHealth,
    candidates: buildSkillRepairCandidates(skill, bindingIndex, servers, toolNames),
  };
}

function parseRepairRequest(value: unknown): SkillBindingRepairRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SkillDependencyRepairError("INVALID_REQUEST", "修复请求无效", 400);
  }
  const raw = value as Record<string, any>;
  const expectedRevision = typeof raw.expectedRevision === "string" ? raw.expectedRevision.trim() : "";
  if (!/^[a-f0-9]{64}$/i.test(expectedRevision)) {
    throw new SkillDependencyRepairError("INVALID_REVISION", "expectedRevision 无效", 400);
  }
  const expectedBinding = validateBinding(raw.expectedBinding, "expectedBinding");
  const replacementRaw = raw.replacement;
  if (!replacementRaw || typeof replacementRaw !== "object" || Array.isArray(replacementRaw)) {
    throw new SkillDependencyRepairError("INVALID_REPLACEMENT", "replacement 无效", 400);
  }
  const serverId = typeof replacementRaw.serverId === "string" ? replacementRaw.serverId.trim() : "";
  const toolName = typeof replacementRaw.toolName === "string" ? replacementRaw.toolName.trim() : "";
  if (!serverId || serverId.length > 80 || !toolName || toolName.length > 256) {
    throw new SkillDependencyRepairError("INVALID_REPLACEMENT", "replacement 字段无效", 400);
  }
  const expectedToolListRevision = Number(raw.expectedToolListRevision);
  if (!Number.isInteger(expectedToolListRevision) || expectedToolListRevision < 0) {
    throw new SkillDependencyRepairError("INVALID_TOOL_REVISION", "expectedToolListRevision 无效", 400);
  }
  const promptPolicy = raw.promptPolicy;
  if (promptPolicy !== "preserve" && promptPolicy !== "replace-exact") {
    throw new SkillDependencyRepairError("INVALID_PROMPT_POLICY", "promptPolicy 无效", 400);
  }
  return {
    expectedRevision,
    expectedBinding,
    replacement: { serverId, toolName },
    expectedToolListRevision,
    promptPolicy,
  };
}

function resolveCandidate(
  skill: Skill,
  bindingIndex: number,
  request: SkillBindingRepairRequest
): SkillRepairCandidate {
  const candidates = buildSkillRepairCandidates(
    skill,
    bindingIndex,
    listPublicMcpServers(),
    registeredToolNames()
  );
  const candidate = candidates.find((item) =>
    item.serverId === request.replacement.serverId && item.toolName === request.replacement.toolName
  );
  if (!candidate) {
    throw new SkillDependencyRepairError(
      "REPLACEMENT_UNAVAILABLE",
      "目标 MCP 工具当前不可用，请重新加载候选",
      409
    );
  }
  if (candidate.toolListRevision !== request.expectedToolListRevision) {
    throw new SkillDependencyRepairError(
      "TOOL_LIST_CHANGED",
      "MCP 工具列表已变化，请重新预览",
      409,
      { currentToolListRevision: candidate.toolListRevision }
    );
  }
  return candidate;
}

function replaceReferences(
  values: string[] | undefined,
  oldName: string,
  newName: string,
  keepOld: boolean,
  ensureNew: boolean
): string[] | undefined {
  if (!values) return undefined;
  const hadOld = values.includes(oldName);
  const next: string[] = [];
  for (const value of values) {
    if (value === oldName && !keepOld) {
      if (!next.includes(newName)) next.push(newName);
      continue;
    }
    if (!next.includes(value)) next.push(value);
  }
  if ((ensureNew || hadOld) && !next.includes(newName)) next.push(newName);
  return next;
}

function replaceStandaloneToken(input: string, oldToken: string, newToken: string): { value: string; count: number } {
  if (!oldToken || oldToken === newToken) return { value: input, count: 0 };
  const tokenChar = /[a-zA-Z0-9_-]/;
  let cursor = 0;
  let count = 0;
  let output = "";
  while (cursor < input.length) {
    const found = input.indexOf(oldToken, cursor);
    if (found < 0) {
      output += input.slice(cursor);
      break;
    }
    const before = found > 0 ? input[found - 1] : "";
    const afterIndex = found + oldToken.length;
    const after = afterIndex < input.length ? input[afterIndex] : "";
    output += input.slice(cursor, found);
    if ((!before || !tokenChar.test(before)) && (!after || !tokenChar.test(after))) {
      output += newToken;
      count += 1;
    } else {
      output += oldToken;
    }
    cursor = afterIndex;
  }
  return { value: output, count };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function buildSkillBindingRepair(
  skill: Skill,
  bindingIndex: number,
  candidate: SkillRepairCandidate,
  promptPolicy: SkillRepairPromptPolicy
): Omit<SkillBindingRepairPlan, "skillId" | "skillName" | "bindingIndex" | "expectedRevision" | "expectedToolListRevision" | "candidate"> {
  const originalBinding = validateIndex(skill, bindingIndex);
  const replacementBinding: McpSkillBinding = {
    serverId: candidate.serverId,
    toolName: candidate.toolName,
    registeredName: candidate.registeredName,
  };
  const bindings = (skill.mcpBindings || []).map((binding) => ({ ...binding }));
  const otherBindings = bindings.filter((_binding, index) => index !== bindingIndex);
  if (otherBindings.some((binding) => binding.serverId === replacementBinding.serverId && binding.toolName === replacementBinding.toolName)) {
    throw new SkillDependencyRepairError("DUPLICATE_BINDING", "Skill 已绑定目标 MCP 工具", 409);
  }
  if (otherBindings.some((binding) => binding.registeredName === replacementBinding.registeredName)) {
    throw new SkillDependencyRepairError("DUPLICATE_REGISTERED_NAME", "Skill 已使用目标工具注册名", 409);
  }
  bindings[bindingIndex] = replacementBinding;

  const oldNameStillUsed = otherBindings.some((binding) => binding.registeredName === originalBinding.registeredName);
  const allowedTools = replaceReferences(
    skill.allowedTools,
    originalBinding.registeredName,
    replacementBinding.registeredName,
    oldNameStillUsed,
    Array.isArray(skill.allowedTools) && skill.allowedTools.length > 0
  );
  const requiredTools = replaceReferences(
    skill.requiredTools || [],
    originalBinding.registeredName,
    replacementBinding.registeredName,
    oldNameStillUsed,
    false
  ) || [];

  const warnings: string[] = [];
  if (candidate.serverId !== originalBinding.serverId) warnings.push("目标工具来自不同 MCP Server，请确认信任边界和配置来源");
  if (candidate.toolName !== originalBinding.toolName) warnings.push("目标工具名称不同，请确认 Skill 语义和参数仍然适用");
  if (candidate.risk === "write") warnings.push("目标工具具有写入风险，调用时将遵循当前 MCP 权限策略");
  if (candidate.risk === "destructive") warnings.push("目标工具具有危险操作风险，请谨慎确认绑定");
  if (candidate.schemaCompatibility === "unknown") warnings.push("当前 binding 没有 Schema 基线，无法自动确认参数兼容性");

  let systemPrompt = skill.systemPrompt;
  let promptReplacementCount = 0;
  if (promptPolicy === "replace-exact") {
    if (oldNameStillUsed) {
      warnings.push("旧注册名仍被其他 binding 使用，Prompt 未自动替换");
    } else {
      const replaced = replaceStandaloneToken(systemPrompt, originalBinding.registeredName, replacementBinding.registeredName);
      systemPrompt = replaced.value;
      promptReplacementCount = replaced.count;
      if (replaced.count === 0) warnings.push("Prompt 中未找到独立的旧注册名引用，Prompt 保持不变");
    }
  } else if (systemPrompt.includes(originalBinding.registeredName)) {
    warnings.push("Prompt 仍包含旧注册名；保存后建议手动检查 Skill Prompt");
  }

  const nextSkill: Skill = {
    ...skill,
    mcpBindings: bindings,
    allowedTools,
    requiredTools,
    systemPrompt,
  };
  const changes: SkillRepairChange[] = [];
  if (!sameValue(skill.mcpBindings || [], bindings)) {
    changes.push({ field: "mcpBindings", before: skill.mcpBindings || [], after: bindings });
  }
  if (!sameValue(skill.allowedTools, allowedTools)) changes.push({ field: "allowedTools", before: skill.allowedTools || [], after: allowedTools || [] });
  if (!sameValue(skill.requiredTools || [], requiredTools)) changes.push({ field: "requiredTools", before: skill.requiredTools || [], after: requiredTools });
  if (skill.systemPrompt !== systemPrompt) changes.push({ field: "systemPrompt", before: skill.systemPrompt, after: systemPrompt });

  return {
    originalBinding,
    replacementBinding,
    promptPolicy,
    promptReplacementCount,
    changes,
    warnings,
    nextSkill,
  };
}

function buildRepairPlan(skillId: string, bindingIndex: number, input: unknown): SkillBindingRepairPlan {
  const request = parseRepairRequest(input);
  const skill = loadRepairableSkill(skillId);
  const currentRevision = skillDependencyRevision(skill);
  if (currentRevision !== request.expectedRevision) {
    throw new SkillDependencyRepairError(
      "SKILL_REVISION_CHANGED",
      "Skill 已被修改，请重新预览",
      409,
      { currentRevision }
    );
  }
  const currentBinding = validateIndex(skill, bindingIndex);
  if (!bindingEquals(currentBinding, request.expectedBinding)) {
    throw new SkillDependencyRepairError(
      "BINDING_CHANGED",
      "MCP binding 已变化，请重新预览",
      409,
      { currentBinding }
    );
  }
  const candidate = resolveCandidate(skill, bindingIndex, request);
  const repair = buildSkillBindingRepair(skill, bindingIndex, candidate, request.promptPolicy);
  return {
    skillId: skill.id,
    skillName: skill.name,
    bindingIndex,
    expectedRevision: currentRevision,
    expectedToolListRevision: candidate.toolListRevision,
    candidate,
    ...repair,
  };
}

function publicPreview(plan: SkillBindingRepairPlan): SkillBindingRepairPreview {
  const { nextSkill: _nextSkill, ...preview } = plan;
  return preview;
}

export function previewSkillBindingRepair(skillId: string, bindingIndex: number, input: unknown): SkillBindingRepairPreview {
  return publicPreview(buildRepairPlan(skillId, bindingIndex, input));
}

export function applySkillBindingRepair(skillId: string, bindingIndex: number, input: unknown) {
  const plan = buildRepairPlan(skillId, bindingIndex, input);
  saveSkill(plan.nextSkill, { resetLearning: false });
  const afterRevision = skillDependencyRevision(plan.nextSkill);
  const auditEvent = createSkillDependencyRepairAuditEvent({
    skillId: plan.skillId,
    bindingIndex: plan.bindingIndex,
    beforeRevision: plan.expectedRevision,
    afterRevision,
    beforeBinding: plan.originalBinding,
    afterBinding: plan.replacementBinding,
    changedFields: plan.changes.map((change) => change.field),
    promptPolicy: plan.promptPolicy,
    promptReplacementCount: plan.promptReplacementCount,
    warnings: plan.warnings,
  });
  let auditRecorded = true;
  let auditWarning: string | undefined;
  try {
    appendSkillDependencyRepairAuditEvent(auditEvent);
  } catch (error) {
    auditRecorded = false;
    auditWarning = error instanceof Error ? error.message : "依赖修复审计写入失败";
    console.error("[dependency-repair] audit write failed:", error);
  }
  return {
    preview: publicPreview(plan),
    beforeRevision: plan.expectedRevision,
    afterRevision,
    skill: plan.nextSkill,
    dependencyHealth: getSkillDependencyHealth(plan.nextSkill),
    auditRecorded,
    auditEvent: auditRecorded ? auditEvent : undefined,
    auditWarning,
  };
}
