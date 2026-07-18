// WahtWay Skill Hub 类型定义

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
  keywords?: string[];
}

// ---- 同学新增：Skill Hub 管理类型 ----

export type SkillStatus = "draft" | "pending" | "published" | "rejected" | "archived";
export type SkillVisibility = "public" | "unlisted";

export interface SkillVersion {
  version: string;
  changelog?: string;
  checksum: string;
  createdAt: string;
  manifest: Skill;
}

export interface SkillReview {
  rating: number;
  comment?: string;
  createdAt: string;
}

export interface SkillReport {
  reason: string;
  createdAt: string;
}

export interface SkillHubRecord {
  skillId: string;
  slug: string;
  name: string;
  description: string;
  authorName?: string;
  category?: string;
  tags: string[];
  status: SkillStatus;
  visibility: SkillVisibility;
  currentVersion: string;
  downloadCount: number;
  ratingAverage: number;
  ratingCount: number;
  reportCount: number;
  createdAt: string;
  updatedAt: string;
  versions: SkillVersion[];
  reviews: SkillReview[];
  reports: SkillReport[];
}

export interface SkillHubDatabase {
  schemaVersion: 1;
  records: SkillHubRecord[];
}

export interface SkillListItem {
  id: string;
  skillId: string;
  manifestId: string;
  name: string;
  description: string;
  input?: JSONSchema;
  output?: JSONSchema;
  systemPrompt?: string;
  requiredTools?: string[];
  keywords?: string[];
  category?: string;
  tags: string[];
  authorName?: string;
  version: string;
  downloadCount: number;
  ratingAverage: number;
  createdAt?: string;
  updatedAt: string;
  status?: SkillStatus;
  ratingCount?: number;
  visibility?: SkillVisibility;
  [key: string]: any;
}
