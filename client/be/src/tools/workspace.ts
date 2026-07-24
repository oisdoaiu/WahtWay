import * as fs from "fs";
import * as path from "path";
import { ToolExecutionContext } from "../types";

export function normalizeWorkspace(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const workspace = path.resolve(value.trim());
  if (!fs.existsSync(workspace)) throw new Error("工作区不存在");
  if (!fs.statSync(workspace).isDirectory()) throw new Error("工作区必须是文件夹");
  return workspace;
}

export function resolveToolPath(value: unknown, context?: ToolExecutionContext): string {
  const input = typeof value === "string" ? value.trim() : "";
  if (!input) return context?.workspace || "";
  if (path.isAbsolute(input)) return path.normalize(input);
  return path.resolve(context?.workspace || process.cwd(), input);
}
