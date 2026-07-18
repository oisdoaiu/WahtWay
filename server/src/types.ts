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
  keywords?: string[];
}

export type SkillStatus = "draft" | "pending" | "published" | "rejected" | "archived";
export type SkillVisibility = "public" | "unlisted";
export type UserRole = "user" | "admin";

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
}

export interface StoredUser extends PublicUser {
  passwordSalt: string;
  passwordHash: string;
  passwordIterations: number;
}

export interface AuthDatabase {
  schemaVersion: 1;
  users: StoredUser[];
}

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
  authorUserId?: string;
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
  input: JSONSchema;
  output: JSONSchema;
  requiredTools: string[];
  keywords?: string[];
  authorName?: string;
  category?: string;
  tags: string[];
  version: string;
  status: SkillStatus;
  visibility: SkillVisibility;
  downloadCount: number;
  ratingAverage: number;
  ratingCount: number;
  updatedAt: string;
}
