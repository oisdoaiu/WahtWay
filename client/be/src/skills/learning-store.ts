import * as fs from "fs";
import * as path from "path";
import {
  GapEvidence,
  LearnedSkillVersion,
  Skill,
  SkillLearningState,
  SkillRunRecord,
  SkillVersionEvaluation,
} from "../types";
import {
  getSkillLearningStatesDir,
  getSkillRunsDir,
} from "../runtime-data";

const SKILL_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const MAX_EVIDENCE_PER_SKILL = 300;

function assertSkillId(skillId: string): void {
  if (!SKILL_ID.test(skillId)) {
    throw new Error(`无效的 Skill ID: ${skillId}`);
  }
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(tempPath, filePath);
}

function statePath(skillId: string): string {
  assertSkillId(skillId);
  return path.join(getSkillLearningStatesDir(), `${skillId}.json`);
}

function runPath(runId: string): string {
  if (!/^[a-f0-9-]{16,64}$/i.test(runId)) throw new Error("无效的 Skill run ID");
  return path.join(getSkillRunsDir(), `${runId}.json`);
}

function defaultState(skillId: string): SkillLearningState {
  return {
    schemaVersion: 1,
    skillId,
    autoImprove: true,
    activeVersion: 1,
    runCount: 0,
    evidence: [],
    versions: [],
  };
}

export function readLearningState(skillId: string): SkillLearningState {
  const filePath = statePath(skillId);
  if (!fs.existsSync(filePath)) return defaultState(skillId);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as SkillLearningState;
    return {
      ...defaultState(skillId),
      ...parsed,
      skillId,
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
      versions: Array.isArray(parsed.versions) ? parsed.versions : [],
    };
  } catch (error) {
    console.warn(`读取 Skill 学习状态失败 (${skillId}):`, error);
    return defaultState(skillId);
  }
}

export function saveLearningState(state: SkillLearningState): void {
  writeJsonAtomic(statePath(state.skillId), state);
}

export function getActiveSkillOverride(skillId: string): Skill | null {
  const state = readLearningState(skillId);
  if (state.activeVersion <= 1) return null;
  const version = state.versions.find((item) => item.version === state.activeVersion);
  if (!version) return null;
  return {
    ...version.manifest,
    version: version.version,
    origin: "learned",
  };
}

export function recordRunStarted(run: SkillRunRecord): void {
  writeJsonAtomic(runPath(run.id), run);
  const state = readLearningState(run.skillId);
  state.runCount += 1;
  state.lastObservedAt = run.startedAt;
  saveLearningState(state);
}

export function readSkillRun(runId: string): SkillRunRecord | null {
  const filePath = runPath(runId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as SkillRunRecord;
  } catch {
    return null;
  }
}

export function saveSkillRun(run: SkillRunRecord): void {
  writeJsonAtomic(runPath(run.id), run);
}

export function listRecentSkillRuns(skillId: string, limit = 20): SkillRunRecord[] {
  assertSkillId(skillId);
  if (!fs.existsSync(getSkillRunsDir())) return [];
  return fs.readdirSync(getSkillRunsDir())
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(getSkillRunsDir(), name), "utf-8")) as SkillRunRecord;
      } catch {
        return null;
      }
    })
    .filter((run): run is SkillRunRecord => !!run && run.skillId === skillId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
}

export function findPendingRunForConversation(conversationId: string): SkillRunRecord | null {
  if (!conversationId || !fs.existsSync(getSkillRunsDir())) return null;
  const candidates = fs.readdirSync(getSkillRunsDir())
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const filePath = path.join(getSkillRunsDir(), name);
      try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8")) as SkillRunRecord;
      } catch {
        return null;
      }
    })
    .filter((run): run is SkillRunRecord =>
      !!run &&
      run.conversationId === conversationId &&
      run.status === "completed" &&
      !run.delayedEvaluatedAt
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return candidates[0] || null;
}

export function addGapEvidence(skillId: string, gaps: GapEvidence[]): void {
  if (gaps.length === 0) return;
  const state = readLearningState(skillId);
  for (const gap of gaps) {
    const existing = state.evidence.find(
      (item) => item.runId === gap.runId && item.clusterKey === gap.clusterKey
    );
    if (existing) {
      existing.phase = gap.phase;
      existing.confidence = Math.max(existing.confidence, gap.confidence);
      existing.severity = Math.max(existing.severity, gap.severity);
      existing.learnable = existing.learnable || gap.learnable;
      existing.expected = gap.expected || existing.expected;
      existing.observed = gap.observed || existing.observed;
      existing.improvementHint = gap.improvementHint || existing.improvementHint;
      existing.evidence = Array.from(new Set([...existing.evidence, ...gap.evidence])).slice(0, 8);
      continue;
    }
    state.evidence.push(gap);
  }
  state.evidence = state.evidence.slice(-MAX_EVIDENCE_PER_SKILL);
  state.lastObservedAt = new Date().toISOString();
  saveLearningState(state);
}

export function getEligibleEvidenceCluster(
  skillId: string,
  minimumRuns = 3
): GapEvidence[] {
  const state = readLearningState(skillId);
  if (!state.autoImprove) return [];
  const consumed = new Set(state.versions.flatMap((version) => version.basedOnEvidenceIds));
  const eligible = state.evidence.filter(
    (item) => item.learnable && item.confidence >= 0.75 && !consumed.has(item.id)
  );
  const clusters = new Map<string, GapEvidence[]>();
  for (const item of eligible) {
    const list = clusters.get(item.clusterKey) || [];
    list.push(item);
    clusters.set(item.clusterKey, list);
  }
  return Array.from(clusters.values())
    .filter((items) => new Set(items.map((item) => item.runId)).size >= minimumRuns)
    .sort((a, b) => {
      const scoreA = a.reduce((sum, item) => sum + item.confidence * item.severity, 0);
      const scoreB = b.reduce((sum, item) => sum + item.confidence * item.severity, 0);
      return scoreB - scoreA;
    })[0] || [];
}

export function createCandidateVersion(
  skillId: string,
  manifest: Skill,
  rationale: string,
  evidenceIds: string[]
): LearnedSkillVersion {
  const state = readLearningState(skillId);
  const versionNumber = Math.max(1, ...state.versions.map((item) => item.version)) + 1;
  const version: LearnedSkillVersion = {
    version: versionNumber,
    status: "candidate",
    manifest: { ...manifest, version: versionNumber, origin: "learned" },
    rationale,
    basedOnEvidenceIds: evidenceIds,
    createdAt: new Date().toISOString(),
  };
  state.versions.push(version);
  saveLearningState(state);
  return version;
}

export function finishCandidateEvaluation(
  skillId: string,
  versionNumber: number,
  evaluation: SkillVersionEvaluation
): boolean {
  const state = readLearningState(skillId);
  const version = state.versions.find((item) => item.version === versionNumber);
  if (!version) throw new Error(`Skill 版本不存在: ${versionNumber}`);
  version.evaluation = evaluation;
  if (!evaluation.approved) version.status = "rejected";
  saveLearningState(state);
  return evaluation.approved;
}

export function activateSkillVersion(skillId: string, versionNumber: number): void {
  const state = readLearningState(skillId);
  const target = state.versions.find((item) => item.version === versionNumber);
  if (versionNumber !== 1 && !target) {
    throw new Error(`Skill 版本不存在: ${versionNumber}`);
  }
  if (target && target.evaluation?.approved !== true) {
    throw new Error(`Skill 版本 ${versionNumber} 未通过自动评估`);
  }
  for (const item of state.versions) {
    if (item.status === "active") item.status = "superseded";
    if (item.version === versionNumber) {
      item.status = "active";
      item.activatedAt = new Date().toISOString();
    }
  }
  state.activeVersion = versionNumber;
  state.lastImprovedAt = new Date().toISOString();
  saveLearningState(state);
}

export function setAutoImprove(skillId: string, enabled: boolean): void {
  const state = readLearningState(skillId);
  state.autoImprove = enabled;
  saveLearningState(state);
}

export function resetActiveSkillVersion(skillId: string): void {
  const state = readLearningState(skillId);
  state.activeVersion = 1;
  for (const version of state.versions) {
    if (version.status === "active") version.status = "superseded";
  }
  saveLearningState(state);
}

export function deleteSkillLearning(skillId: string): void {
  const filePath = statePath(skillId);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  if (!fs.existsSync(getSkillRunsDir())) return;
  for (const name of fs.readdirSync(getSkillRunsDir()).filter((item) => item.endsWith(".json"))) {
    const filePath = path.join(getSkillRunsDir(), name);
    try {
      const run = JSON.parse(fs.readFileSync(filePath, "utf-8")) as SkillRunRecord;
      if (run.skillId === skillId) fs.unlinkSync(filePath);
    } catch {}
  }
}

export function getLearningSummary(skillId: string) {
  const state = readLearningState(skillId);
  const learnable = state.evidence.filter((item) => item.learnable && item.confidence >= 0.75);
  const latestEvidence = [...learnable].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const latestVersion = state.versions.length
    ? Math.max(...state.versions.map((item) => item.version))
    : 1;
  return {
    autoImprove: state.autoImprove,
    activeVersion: state.activeVersion,
    latestVersion,
    runCount: state.runCount,
    evidenceCount: learnable.length,
    lastObservedAt: state.lastObservedAt,
    lastImprovedAt: state.lastImprovedAt,
    lastInsight: latestEvidence?.improvementHint || latestEvidence?.expected || "",
  };
}
