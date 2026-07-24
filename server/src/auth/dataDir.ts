import * as fs from "fs";
import * as path from "path";

const DEFAULT_AUTH_DIR = path.resolve(__dirname, "../../data/hub");

export const AUTH_DATA_DIR = process.env.SKILL_HUB_DATA_DIR
  ? path.resolve(process.env.SKILL_HUB_DATA_DIR)
  : DEFAULT_AUTH_DIR;

export function ensureAuthDataDir(): void {
  if (!fs.existsSync(AUTH_DATA_DIR)) {
    fs.mkdirSync(AUTH_DATA_DIR, { recursive: true });
  }
}
