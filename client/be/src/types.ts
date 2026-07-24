// WahtWay 核心类型定义
// 对应架构设计中的 Skill / Tool / AgentResult 数据模型

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface JSONSchemaProperty {
  type: string;
  description: string;
  enum?: string[];
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  input: JSONSchema;
  output: JSONSchema;
  requiredTools: string[];
  allowedTools?: string[];
  whenToUse?: string;
  keywords?: string[];  // V0.3 关键词匹配
  version?: number;
  origin?: "builtin" | "custom" | "hub" | "learned";
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface NeedSnapshot {
  primaryGoal: string;
  constraints: string[];
  expectedDeliverables: string[];
  formatPreferences: string[];
  knownPreferences: string[];
  ambiguities: string[];
  confidence: number;
}

export type GapType =
  | "skill-match"
  | "skill-prompt"
  | "user-preference"
  | "session-constraint"
  | "tool-runtime"
  | "ambiguous";

export type GapCategory =
  | "missing-constraint"
  | "wrong-format"
  | "incomplete-deliverable"
  | "wrong-skill-trigger"
  | "excessive-verbosity"
  | "insufficient-detail"
  | "ignored-context"
  | "tool-selection"
  | "factual-quality"
  | "other";

export interface GapEvidence {
  id: string;
  runId: string;
  phase: "immediate" | "delayed";
  type: GapType;
  category: GapCategory;
  clusterKey: string;
  expected: string;
  observed: string;
  evidence: string[];
  improvementHint: string;
  severity: number;
  confidence: number;
  learnable: boolean;
  createdAt: string;
}

export interface RunAssessment {
  satisfactionScore: number;
  summary: string;
  gaps: GapEvidence[];
  evaluatedAt: string;
}

export interface SkillRunRecord {
  id: string;
  traceId: string;
  skillId: string;
  skillName: string;
  skillVersion: number;
  skillSnapshot: Skill;
  conversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  contextBefore: ConversationTurn[];
  userMessage: string;
  needSnapshot: NeedSnapshot;
  needSnapshotSource: "skill-match" | "context-observer" | "current-message";
  output: string;
  toolCalls: { toolName: string; ok: boolean; summary: string }[];
  stats?: AgentStatsSnapshot;
  status: "running" | "completed" | "aborted" | "error";
  startedAt: string;
  completedAt?: string;
  immediateAssessment?: RunAssessment;
  delayedAssessment?: RunAssessment;
  delayedEvaluatedAt?: string;
}

export interface AgentStatsSnapshot {
  totalTokens: number;
  totalTime: number;
  rounds: number;
  toolCalls: number;
  model: string;
}

export interface SkillVersionEvaluation {
  approved: boolean;
  baselineScore: number;
  candidateScore: number;
  addressedGaps: string[];
  regressions: string[];
  summary: string;
  evaluatedAt: string;
}

export interface LearnedSkillVersion {
  version: number;
  status: "candidate" | "active" | "rejected" | "superseded";
  manifest: Skill;
  rationale: string;
  basedOnEvidenceIds: string[];
  createdAt: string;
  activatedAt?: string;
  evaluation?: SkillVersionEvaluation;
}

export interface SkillLearningState {
  schemaVersion: 1;
  skillId: string;
  autoImprove: boolean;
  activeVersion: number;
  runCount: number;
  evidence: GapEvidence[];
  versions: LearnedSkillVersion[];
  lastObservedAt?: string;
  lastImprovedAt?: string;
}

export interface AgentResult {
  skillName: string;
  skillId: string;
  output: string;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ToolExecutionContext {
  workspace?: string;
}

// V0.9 Tool 定义
export interface ToolDef {
  input_examples?: { args: Record<string, unknown>; description: string }[];  // V0.17
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (args: Record<string, unknown>, context?: ToolExecutionContext) => Promise<string>;
}
