import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { PublicUser, UserRole } from "../types";
import { AUTH_DATA_DIR, ensureAuthDataDir } from "./dataDir";
import { AuthError, getUserById } from "./userStore";

const SECRET_FILE = path.join(AUTH_DATA_DIR, "auth-secret.txt");
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

interface TokenPayload {
  sub: string;
  username: string;
  displayName: string;
  role: UserRole;
  iat: number;
  exp: number;
}

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf-8").toString("base64url");
}

function loadSecret(): string {
  if (process.env.AUTH_TOKEN_SECRET) {
    return process.env.AUTH_TOKEN_SECRET;
  }
  if (fs.existsSync(SECRET_FILE)) {
    return fs.readFileSync(SECRET_FILE, "utf-8").trim();
  }

  ensureAuthDataDir();
  const secret = crypto.randomBytes(32).toString("base64url");
  fs.writeFileSync(SECRET_FILE, secret, "utf-8");
  return secret;
}

function sign(data: string): string {
  return crypto.createHmac("sha256", loadSecret()).update(data).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function issueToken(user: PublicUser): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: "HS256", typ: "JWT" });
  const payload = base64urlJson({
    sub: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    iat: issuedAt,
    exp: issuedAt + TOKEN_TTL_SECONDS,
  } satisfies TokenPayload);
  const data = `${header}.${payload}`;
  return `${data}.${sign(data)}`;
}

export function verifyToken(token: string): PublicUser {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AuthError("登录凭证无效", 401);
  }

  const [header, payload, signature] = parts;
  const expectedSignature = sign(`${header}.${payload}`);
  if (!safeEqual(signature, expectedSignature)) {
    throw new AuthError("登录凭证无效", 401);
  }

  let parsed: TokenPayload;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as TokenPayload;
  } catch {
    throw new AuthError("登录凭证无效", 401);
  }

  if (!parsed.sub || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
    throw new AuthError("登录已过期", 401);
  }

  const user = getUserById(parsed.sub);
  if (!user) {
    throw new AuthError("用户不存在", 401);
  }

  return user;
}
