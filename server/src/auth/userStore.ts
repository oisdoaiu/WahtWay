import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { AuthDatabase, PublicUser, StoredUser, UserRole } from "../types";
import { AUTH_DATA_DIR, ensureAuthDataDir } from "./dataDir";

const USERS_FILE = path.join(AUTH_DATA_DIR, "users.json");
const USERNAME_PATTERN = /^[a-zA-Z0-9_][a-zA-Z0-9_-]{2,31}$/;
const PASSWORD_ITERATIONS = 120000;
const PASSWORD_KEY_LENGTH = 32;

export class AuthError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function readDb(): AuthDatabase {
  if (!fs.existsSync(USERS_FILE)) {
    return { schemaVersion: 1, users: [] };
  }

  const parsed = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8")) as AuthDatabase;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.users)) {
    throw new AuthError("用户数据库格式不正确", 500);
  }
  return parsed;
}

function writeDb(db: AuthDatabase): void {
  ensureAuthDataDir();
  const tmpFile = `${USERS_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), "utf-8");
  fs.renameSync(tmpFile, USERS_FILE);
}

function normalizeUsername(username: unknown): string {
  if (typeof username !== "string") {
    throw new AuthError("username 必须是字符串");
  }
  const normalized = username.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new AuthError("用户名需为 3-32 位，只能包含字母、数字、下划线和连字符");
  }
  return normalized;
}

function normalizePassword(password: unknown): string {
  if (typeof password !== "string") {
    throw new AuthError("password 必须是字符串");
  }
  if (password.length < 8 || password.length > 128) {
    throw new AuthError("密码长度必须在 8-128 位之间");
  }
  return password;
}

function normalizeDisplayName(displayName: unknown, username: string): string {
  if (displayName === undefined || displayName === null || displayName === "") {
    return username;
  }
  if (typeof displayName !== "string") {
    throw new AuthError("displayName 必须是字符串");
  }
  const trimmed = displayName.trim();
  if (trimmed.length < 1 || trimmed.length > 40) {
    throw new AuthError("展示名长度必须在 1-40 位之间");
  }
  return trimmed;
}

function toPublicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
  };
}

function hashPassword(password: string, salt: string): string {
  return crypto
    .pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, "sha256")
    .toString("base64url");
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function createUser(input: {
  username: unknown;
  password: unknown;
  displayName?: unknown;
  role?: UserRole;
}): PublicUser {
  const db = readDb();
  const username = normalizeUsername(input.username);
  const password = normalizePassword(input.password);
  const displayName = normalizeDisplayName(input.displayName, username);

  if (db.users.some((user) => user.username === username)) {
    throw new AuthError("用户名已存在", 409);
  }

  const salt = crypto.randomBytes(16).toString("base64url");
  const user: StoredUser = {
    id: crypto.randomUUID(),
    username,
    displayName,
    role: input.role || "user",
    createdAt: nowIso(),
    passwordSalt: salt,
    passwordHash: hashPassword(password, salt),
    passwordIterations: PASSWORD_ITERATIONS,
  };

  db.users.push(user);
  writeDb(db);
  return toPublicUser(user);
}

export function verifyCredentials(usernameInput: unknown, passwordInput: unknown): PublicUser {
  const username = normalizeUsername(usernameInput);
  const password = normalizePassword(passwordInput);
  const user = readDb().users.find((item) => item.username === username);
  if (!user) {
    throw new AuthError("用户名或密码错误", 401);
  }

  const candidate = hashPassword(password, user.passwordSalt);
  if (!timingSafeEqual(candidate, user.passwordHash)) {
    throw new AuthError("用户名或密码错误", 401);
  }

  return toPublicUser(user);
}

export function getUserById(userId: string): PublicUser | undefined {
  const user = readDb().users.find((item) => item.id === userId);
  return user ? toPublicUser(user) : undefined;
}
