import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
  Skill,
  SkillHubDatabase,
  SkillHubRecord,
  SkillListItem,
  SkillReview,
  SkillStatus,
  SkillVisibility,
  SkillVersion,
} from "../types";
import { sanitizeSkillManifest } from "./validation";

const DEFAULT_DATA_DIR = path.resolve(__dirname, "../../data/hub");
const DATA_DIR = process.env.SKILL_HUB_DATA_DIR
  ? path.resolve(process.env.SKILL_HUB_DATA_DIR)
  : DEFAULT_DATA_DIR;
const DB_FILE = path.join(DATA_DIR, "skills.json");
const SEED_SKILLS_DIR = path.resolve(__dirname, "../../data/skills");

type SkillSort = "latest" | "downloads" | "rating" | "name";

interface CreateSkillInput {
  manifest: Skill;
  version: string;
  changelog?: string;
  authorName?: string;
  category?: string;
  tags: string[];
  visibility: SkillVisibility;
  status: SkillStatus;
}

interface UpdateSkillMetadataInput {
  status?: SkillStatus;
  visibility?: SkillVisibility;
  authorName?: string;
  category?: string;
  tags?: string[];
}

interface SearchSkillsInput {
  q?: string;
  tag?: string;
  category?: string;
  sort?: SkillSort;
  includeUnlisted?: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function checksumSkill(skill: Skill): string {
  return crypto.createHash("sha256").update(JSON.stringify(skill)).digest("hex");
}

function readSeedSkills(): Skill[] {
  if (!fs.existsSync(SEED_SKILLS_DIR)) return [];

  const skills: Skill[] = [];
  for (const file of fs.readdirSync(SEED_SKILLS_DIR).filter((name) => name.endsWith(".json"))) {
    try {
      const raw = fs.readFileSync(path.join(SEED_SKILLS_DIR, file), "utf-8");
      skills.push(sanitizeSkillManifest(JSON.parse(raw)));
    } catch (err: any) {
      console.error(`Seed Skill 加载失败 ${file}: ${err.message}`);
    }
  }
  return skills;
}

function versionOf(manifest: Skill, version: string, changelog?: string): SkillVersion {
  return {
    version,
    changelog,
    checksum: checksumSkill(manifest),
    createdAt: nowIso(),
    manifest,
  };
}

function recordFromSeed(manifest: Skill): SkillHubRecord {
  const createdAt = nowIso();
  return {
    skillId: manifest.id,
    slug: manifest.id,
    name: manifest.name,
    description: manifest.description,
    category: "内置",
    tags: manifest.keywords?.slice(0, 6) || [],
    status: "published",
    visibility: "public",
    currentVersion: "1.0.0",
    downloadCount: 0,
    ratingAverage: 0,
    ratingCount: 0,
    reportCount: 0,
    createdAt,
    updatedAt: createdAt,
    versions: [versionOf(manifest, "1.0.0", "内置示例 Skill")],
    reviews: [],
    reports: [],
  };
}

function seedDatabase(): SkillHubDatabase {
  return {
    schemaVersion: 1,
    records: readSeedSkills().map(recordFromSeed),
  };
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readDb(): SkillHubDatabase {
  if (!fs.existsSync(DB_FILE)) return seedDatabase();

  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, "utf-8")) as SkillHubDatabase;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.records)) {
      throw new Error("数据库格式不正确");
    }
    return parsed;
  } catch (err: any) {
    throw new Error(`Skill Hub 数据读取失败: ${err.message}`);
  }
}

function writeDb(db: SkillHubDatabase): void {
  ensureDataDir();
  const tmpFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), "utf-8");
  fs.renameSync(tmpFile, DB_FILE);
}

function latestVersion(record: SkillHubRecord): SkillVersion {
  const version = record.versions.find((item) => item.version === record.currentVersion);
  if (!version) {
    throw new Error(`Skill ${record.skillId} 缺少当前版本 ${record.currentVersion}`);
  }
  return version;
}

function toListItem(record: SkillHubRecord): SkillListItem {
  const current = latestVersion(record);
  return {
    id: record.skillId,
    skillId: record.skillId,
    manifestId: current.manifest.id,
    name: record.name,
    description: record.description,
    input: current.manifest.input,
    output: current.manifest.output,
    requiredTools: current.manifest.requiredTools,
    keywords: current.manifest.keywords,
    authorName: record.authorName,
    category: record.category,
    tags: record.tags,
    version: record.currentVersion,
    status: record.status,
    visibility: record.visibility,
    downloadCount: record.downloadCount,
    ratingAverage: record.ratingAverage,
    ratingCount: record.ratingCount,
    updatedAt: record.updatedAt,
  };
}

function uniqueSkillId(baseId: string, records: SkillHubRecord[]): string {
  const used = new Set(records.map((record) => record.skillId));
  if (!used.has(baseId)) return baseId;

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${baseId}-${index}`;
    if (!used.has(candidate)) return candidate;
  }

  return `${baseId}-${Date.now()}`;
}

function skillMatches(record: SkillHubRecord, q: string): boolean {
  const needle = q.toLowerCase();
  const current = latestVersion(record);
  const haystack = [
    record.skillId,
    record.name,
    record.description,
    record.authorName,
    record.category,
    ...record.tags,
    ...(current.manifest.keywords || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

function sortRecords(records: SkillHubRecord[], sort: SkillSort): SkillHubRecord[] {
  return [...records].sort((a, b) => {
    if (sort === "downloads") return b.downloadCount - a.downloadCount;
    if (sort === "rating") return b.ratingAverage - a.ratingAverage || b.ratingCount - a.ratingCount;
    if (sort === "name") return a.name.localeCompare(b.name, "zh-Hans-CN");
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export function listSkills(input: SearchSkillsInput = {}): SkillListItem[] {
  const db = readDb();
  const sort = input.sort || "latest";
  let records = db.records.filter((record) => record.status === "published");

  if (!input.includeUnlisted) {
    records = records.filter((record) => record.visibility === "public");
  }
  if (input.q) {
    records = records.filter((record) => skillMatches(record, input.q || ""));
  }
  if (input.category) {
    records = records.filter((record) => record.category === input.category);
  }
  if (input.tag) {
    records = records.filter((record) => record.tags.includes(input.tag || ""));
  }

  return sortRecords(records, sort).map(toListItem);
}

export function getSkill(skillId: string): SkillHubRecord | undefined {
  return readDb().records.find((record) => record.skillId === skillId);
}

export function createSkill(input: CreateSkillInput): SkillHubRecord {
  const db = readDb();
  const skillId = uniqueSkillId(input.manifest.id, db.records);
  const createdAt = nowIso();
  const manifest = { ...input.manifest, id: skillId };
  const record: SkillHubRecord = {
    skillId,
    slug: skillId,
    name: manifest.name,
    description: manifest.description,
    authorName: input.authorName,
    category: input.category,
    tags: input.tags,
    status: input.status,
    visibility: input.visibility,
    currentVersion: input.version,
    downloadCount: 0,
    ratingAverage: 0,
    ratingCount: 0,
    reportCount: 0,
    createdAt,
    updatedAt: createdAt,
    versions: [versionOf(manifest, input.version, input.changelog)],
    reviews: [],
    reports: [],
  };

  db.records.push(record);
  writeDb(db);
  return record;
}

export function addSkillVersion(
  skillId: string,
  manifest: Skill,
  version: string,
  changelog?: string
): SkillHubRecord {
  const db = readDb();
  const record = db.records.find((item) => item.skillId === skillId);
  if (!record) throw new Error("Skill not found");

  if (record.versions.some((item) => item.version === version)) {
    throw new Error(`版本 ${version} 已存在`);
  }

  const normalizedManifest = { ...manifest, id: skillId };
  record.versions.push(versionOf(normalizedManifest, version, changelog));
  record.currentVersion = version;
  record.name = normalizedManifest.name;
  record.description = normalizedManifest.description;
  record.tags = record.tags.length > 0 ? record.tags : normalizedManifest.keywords?.slice(0, 6) || [];
  record.updatedAt = nowIso();
  writeDb(db);
  return record;
}

export function updateSkillMetadata(skillId: string, input: UpdateSkillMetadataInput): SkillHubRecord {
  const db = readDb();
  const record = db.records.find((item) => item.skillId === skillId);
  if (!record) throw new Error("Skill not found");

  if (input.status) record.status = input.status;
  if (input.visibility) record.visibility = input.visibility;
  if (input.authorName !== undefined) record.authorName = input.authorName;
  if (input.category !== undefined) record.category = input.category;
  if (input.tags) record.tags = input.tags;
  record.updatedAt = nowIso();

  writeDb(db);
  return record;
}

export function archiveSkill(skillId: string): SkillHubRecord {
  return updateSkillMetadata(skillId, { status: "archived" });
}

export function downloadSkill(skillId: string, version = "latest"): {
  record: SkillHubRecord;
  version: SkillVersion;
} {
  const db = readDb();
  const record = db.records.find((item) => item.skillId === skillId);
  if (!record || record.status !== "published") throw new Error("Skill not found");

  const selectedVersion =
    version === "latest"
      ? latestVersion(record)
      : record.versions.find((item) => item.version === version);
  if (!selectedVersion) throw new Error("Skill version not found");

  record.downloadCount += 1;
  record.updatedAt = nowIso();
  writeDb(db);

  return { record, version: selectedVersion };
}

export function listVersions(skillId: string): Omit<SkillVersion, "manifest">[] {
  const record = getSkill(skillId);
  if (!record) throw new Error("Skill not found");
  return record.versions.map(({ manifest: _manifest, ...version }) => version);
}

export function addReview(skillId: string, rating: number, comment?: string): SkillHubRecord {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error("rating 必须是 1-5 的整数");
  }

  const db = readDb();
  const record = db.records.find((item) => item.skillId === skillId);
  if (!record) throw new Error("Skill not found");

  const review: SkillReview = { rating, comment, createdAt: nowIso() };
  record.reviews.push(review);
  record.ratingCount = record.reviews.length;
  record.ratingAverage = Number(
    (record.reviews.reduce((sum, item) => sum + item.rating, 0) / record.ratingCount).toFixed(2)
  );
  record.updatedAt = nowIso();
  writeDb(db);
  return record;
}

export function addReport(skillId: string, reason: string): SkillHubRecord {
  const db = readDb();
  const record = db.records.find((item) => item.skillId === skillId);
  if (!record) throw new Error("Skill not found");

  record.reports.push({ reason, createdAt: nowIso() });
  record.reportCount = record.reports.length;
  record.updatedAt = nowIso();
  writeDb(db);
  return record;
}

export function summarizeSkill(record: SkillHubRecord): SkillListItem {
  return toListItem(record);
}
