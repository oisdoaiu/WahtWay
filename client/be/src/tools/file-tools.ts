// 本地文件操作 Tool
// 在 Electron 环境下通过 Node.js fs 访问用户文件系统

import * as fs from "fs";
import * as path from "path";
import { ToolDef } from "../types";

/** 列出目录下的文件和子目录 */
export const listFilesTool: ToolDef = {
  name: "list-files",
  description: "列出指定目录下的所有文件和子目录（不含子目录内容）",
  parameters: {
    type: "object",
    properties: {
      directory: {
        type: "string",
        description: "要列出的目录路径，如 C:/Users/用户名/Desktop",
      },
    },
    required: ["directory"],
  },
  execute: async (args) => {
    const dir = String(args.directory);
    if (!fs.existsSync(dir)) return `目录不存在: ${dir}`;
    if (!fs.statSync(dir).isDirectory()) return `不是目录: ${dir}`;

    const entries = fs.readdirSync(dir);
    if (entries.length === 0) return `目录 "${dir}" 是空的`;

    const items = entries.map((name) => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      const isDir = stat.isDirectory();
      const size = isDir ? "-" : formatSize(stat.size);
      const mtime = stat.mtime.toLocaleString("zh-CN");
      return `${isDir ? "📁" : "📄"} ${name}  ${size}  ${mtime}`;
    });

    return `目录 "${dir}" 包含 ${items.length} 个项目:\n${items.join("\n")}`;
  },
};

/** 读取文本文件内容 */
export const readFileTool: ToolDef = {
  name: "read-file",
  description: "读取文本文件的内容（.txt .md .js .ts .py .json .html .css 等）",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "文件的完整路径" },
    },
    required: ["path"],
  },
  execute: async (args) => {
    const filePath = String(args.path);
    if (!fs.existsSync(filePath)) return `文件不存在: ${filePath}`;

    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 100 * 1024)
        return `文件过大 (${formatSize(stat.size)})，只显示前 50KB:\n${fs.readFileSync(filePath, "utf-8").slice(0, 50 * 1024)}`;

      const content = fs.readFileSync(filePath, "utf-8");
      return `文件 "${path.basename(filePath)}" 内容 (${formatSize(stat.size)}):\n${content}`;
    } catch {
      return `无法读取文件: ${filePath}（可能是二进制文件或编码不支持）`;
    }
  },
};

/** 按文件名搜索 */
export const searchFilesTool: ToolDef = {
  name: "search-files",
  description: "在指定目录及其子目录中搜索匹配文件名的文件",
  parameters: {
    type: "object",
    properties: {
      directory: { type: "string", description: "搜索的起始目录" },
      pattern: { type: "string", description: "搜索关键词（部分匹配文件名）" },
    },
    required: ["directory", "pattern"],
  },
  execute: async (args) => {
    const dir = String(args.directory);
    const pattern = String(args.pattern).toLowerCase();
    if (!fs.existsSync(dir)) return `目录不存在: ${dir}`;

    const results: string[] = [];
    const walk = (current: string) => {
      try {
        for (const name of fs.readdirSync(current)) {
          const full = path.join(current, name);
          if (name.toLowerCase().includes(pattern)) results.push(full);
          if (fs.statSync(full).isDirectory()) walk(full);
        }
      } catch {}
    };
    walk(dir);

    if (results.length === 0) return `在 "${dir}" 中未找到匹配 "${pattern}" 的文件`;
    return `找到 ${results.length} 个匹配 "${pattern}" 的文件:\n${results.slice(0, 50).join("\n")}`;
  },
};

/** 获取文件详细信息 */
export const fileInfoTool: ToolDef = {
  name: "file-info",
  description: "获取文件或目录的详细信息（大小、修改日期、类型）",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "文件或目录的完整路径" },
    },
    required: ["path"],
  },
  execute: async (args) => {
    const filePath = String(args.path);
    if (!fs.existsSync(filePath)) return `路径不存在: ${filePath}`;

    const stat = fs.statSync(filePath);
    const isDir = stat.isDirectory();
    return [
      `名称: ${path.basename(filePath)}`,
      `路径: ${filePath}`,
      `类型: ${isDir ? "目录" : path.extname(filePath) || "未知"}`,
      `大小: ${isDir ? "-" : formatSize(stat.size)}`,
      `创建时间: ${stat.birthtime.toLocaleString("zh-CN")}`,
      `修改时间: ${stat.mtime.toLocaleString("zh-CN")}`,
    ].join("\n");
  },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** 注册所有文件 Tool */
export function registerFileTools(register: (t: ToolDef) => void): void {
  register(listFilesTool);
  register(readFileTool);
  register(searchFilesTool);
  register(fileInfoTool);
}
