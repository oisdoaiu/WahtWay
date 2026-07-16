// 本地文件操作 Tool
// 在 Electron 环境下通过 Node.js fs 访问用户文件系统

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import OpenAI from "openai";
import AdmZip from "adm-zip";
import { resolveModel } from "../models";
import { ToolDef } from "../types";

/** 列出目录下的文件和子目录 */
export const listFilesTool: ToolDef = {
  name: "list-files",
  description: "列出指定目录下的所有文件和子目录。只在用户明确要求查看、浏览、列出某个文件夹的内容时才调用。不要在闲聊、问候、建议类对话中调用。",
      input_examples: [
        { description: "列出桌面文件", args: { directory: "C:\Users\asus\Desktop" } },
        { description: "列出文档目录", args: { directory: "C:\Users\asus\Documents" } },
      ],
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
    try { if (!fs.statSync(dir).isDirectory()) return `不是目录: ${dir}`; }
    catch (e: any) { return `PERMISSION_REQUIRED::权限不足: ${e.message}::${dir}`; }

    try { var entries = fs.readdirSync(dir); }
    catch (e: any) { return `PERMISSION_REQUIRED::权限不足: ${e.message}::${dir}`; }
    if (entries.length === 0) return `目录 "${dir}" 是空的`;

    const items = entries.map((name) => {
      const full = path.join(dir, name);
      try {
        const stat = fs.statSync(full);
        const isDir = stat.isDirectory();
        const size = isDir ? "-" : formatSize(stat.size);
        const mtime = stat.mtime.toLocaleString("zh-CN");
        return `${isDir ? "📁" : "📄"} ${name}  ${size}  ${mtime}`;
      } catch {
        return `🚫 ${name}  (无权限)`;
      }
    });

    return `目录 "${dir}" 包含 ${items.length} 个项目:\n${items.join("\n")}`;
  },
};

/** 读取文本文件内容 */
export const readFileTool: ToolDef = {
  name: "read-file",
  description: "读取文件内容。任何涉及文件内容的任务都必须先用此工具获取内容，包括查看、分析、总结、翻译等。这是文件操作的入口。",
      input_examples: [
        { description: "读取桌面的笔记", args: { path: "C:\Users\asus\Desktop\notes.txt" } },
        { description: "读取项目配置文件", args: { path: "C:\Users\asus\project\config.json" } },
      ],
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
  description: "在指定目录及其子目录中搜索匹配文件名的文件。搜索范围限制在指定目录内，不会搜索整个用户目录。只在用户明确要求搜索、查找、找文件时才调用。不要在闲聊时使用。",
      input_examples: [
        { description: "在桌面搜索报告", args: { directory: "C:\Users\asus\Desktop", pattern: "报告" } },
        { description: "搜索文档中的课件", args: { directory: "C:\Users\asus\Documents", pattern: "课件" } },
      ],
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
    const MAX_RESULTS = 50;
    const MAX_DEPTH = 3;
    const SKIP_DIRS = new Set(["node_modules", ".git", "AppData", ".cache", "__pycache__"]);

    const walk = (current: string, depth: number) => {
      if (depth > MAX_DEPTH || results.length >= MAX_RESULTS) return;
      try {
        for (const name of fs.readdirSync(current)) {
          if (results.length >= MAX_RESULTS) return;
          const full = path.join(current, name);
          if (name.toLowerCase().includes(pattern)) results.push(full);
          try {
            if (fs.statSync(full).isDirectory() && !SKIP_DIRS.has(name)) {
              walk(full, depth + 1);
            }
          } catch {}
        }
      } catch {}
    };
    walk(dir, 1);

    if (results.length === 0) return `在 "${dir}" 中未找到匹配 "${pattern}" 的文件`;
    return `找到 ${results.length} 个匹配 "${pattern}" 的文件:\n${results.slice(0, MAX_RESULTS).join("\n")}`;
  },
};

/** 获取文件详细信息 */
export const fileInfoTool: ToolDef = {
  name: "file-info",
  description: "获取文件或目录的详细信息（大小、修改日期、类型）。只在用户明确询问某个文件/文件夹的详细信息时才调用。",
      input_examples: [
        { description: "查看文件详情", args: { path: "C:\Users\asus\Desktop\report.pdf" } },
        { description: "查看文件夹信息", args: { path: "C:\Users\asus\Documents" } },
      ],
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

// ===== 临时授权 =====
const approvedPaths: Set<string> = new Set();

export function approvePath(p: string): void { approvedPaths.add(p.toLowerCase()); }
export function getPendingApprovals(): string[] { return Array.from(approvedPaths); }

// ===== 安全护栏 =====

const HOME = os.homedir();
const FORBIDDEN_DIRS = [
  path.join(HOME, "AppData"),
  path.join(HOME, ".ssh"),
  path.join(HOME, ".aws"),
  "C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)", "C:\\ProgramData",
  "C:\\$Recycle.Bin",
];
const SENSITIVE_FILES = [".env", "id_rsa", "id_ed25519", "authorized_keys", "known_hosts"];

function isPathSafe(targetPath: string): string | null {
  const resolved = fs.existsSync(targetPath) ? fs.realpathSync(targetPath) : path.resolve(targetPath);
  const lower = resolved.toLowerCase();
  // 已授权路径 → 跳过检查
  if (approvedPaths.has(lower)) return null;
  // 拦截系统目录
  for (const forbid of FORBIDDEN_DIRS) {
    if (lower.startsWith(forbid.toLowerCase())) return `系统目录: ${forbid}`;
  }
  // 拦截敏感文件
  const basename = path.basename(resolved).toLowerCase();
  if (SENSITIVE_FILES.includes(basename)) return `敏感文件: ${basename}`;
  return null;
}

// ===== 回收站 =====
const TRASH_DIR = path.join(HOME, ".wahtway-trash");

function ensureTrashDir() {
  if (!fs.existsSync(TRASH_DIR)) fs.mkdirSync(TRASH_DIR, { recursive: true });
}

function moveToTrash(filePath: string): string {
  ensureTrashDir();
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const trashName = `${ts}_${path.basename(filePath)}`;
  const trashPath = path.join(TRASH_DIR, trashName);

  // 跨盘兼容：先复制再删除源文件
  fs.copyFileSync(filePath, trashPath);
  fs.unlinkSync(filePath);

  // 记录原始路径
  const logFile = path.join(TRASH_DIR, "trash-log.json");
  const log = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, "utf-8")) : [];
  log.push({ originalPath: filePath, trashName, deletedAt: new Date().toISOString() });
  fs.writeFileSync(logFile, JSON.stringify(log, null, 2));
  return trashPath;
}

// ===== 写操作 Tool =====

export const moveFileTool: ToolDef = {
  name: "move-file",
  description: "移动文件到指定目录，或重命名文件。只在用户明确要求移动或重命名文件时才调用。",
      input_examples: [
        { description: "移动桌面文件到文档", args: { source: "C:\Users\asus\Desktop\报告.docx", destination: "C:\Users\asus\Documents\报告.docx" } },
        { description: "重命名文件", args: { source: "C:\Users\asus\old.txt", destination: "C:\Users\asus\new.txt" } },
      ],
  parameters: {
    type: "object",
    properties: {
      source: { type: "string", description: "源文件完整路径" },
      destination: { type: "string", description: "目标路径（可以是目录或新文件名）" },
    },
    required: ["source", "destination"],
  },
  execute: async (args) => {
    const src = String(args.source);
    const dst = String(args.destination);
    if (!fs.existsSync(src)) return `源文件不存在: ${src}`;
    const err = isPathSafe(src) || isPathSafe(dst);
    if (err) return `PERMISSION_REQUIRED::${err}::${src}`;

    try {
      const targetDir = path.dirname(dst);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      // 跨盘兼容：先复制再删除源文件
      fs.copyFileSync(src, dst);
      fs.unlinkSync(src);
      return `✅ 已移动: ${path.basename(src)} → ${dst}`;
    } catch (e: any) {
      return `移动失败: ${e.message}`;
    }
  },
};

export const copyFileTool: ToolDef = {
  name: "copy-file",
  description: "复制文件到指定目录。只在用户明确要求复制文件时才调用。",
      input_examples: [
        { description: "复制文件到备份目录", args: { source: "C:\Users\asus\Documents\论文.docx", destination: "C:\Users\asus\Desktop\备份\论文.docx" } },
      ],
  parameters: {
    type: "object",
    properties: {
      source: { type: "string", description: "源文件完整路径" },
      destination: { type: "string", description: "目标路径" },
    },
    required: ["source", "destination"],
  },
  execute: async (args) => {
    const src = String(args.source);
    const dst = String(args.destination);
    if (!fs.existsSync(src)) return `源文件不存在: ${src}`;
    const err = isPathSafe(dst);
    if (err) return `PERMISSION_REQUIRED::${err}::`;

    try {
      const targetDir = path.dirname(dst);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(src, dst);
      return `✅ 已复制: ${path.basename(src)} → ${dst}`;
    } catch (e: any) {
      return `复制失败: ${e.message}`;
    }
  },
};

export const newFolderTool: ToolDef = {
  name: "new-folder",
  description: "创建新文件夹。只在用户明确要求创建文件夹时调用。",
      input_examples: [
        { description: "在桌面创建作业文件夹", args: { path: "C:\Users\asus\Desktop\作业" } },
      ],
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "新文件夹的完整路径" },
    },
    required: ["path"],
  },
  execute: async (args) => {
    const dirPath = String(args.path);
    const err = isPathSafe(dirPath);
    if (err) return `PERMISSION_REQUIRED::${err}::`;

    try {
      fs.mkdirSync(dirPath, { recursive: true });
      return `✅ 已创建文件夹: ${dirPath}`;
    } catch (e: any) {
      return `创建失败: ${e.message}`;
    }
  },
};

export const writeFileTool: ToolDef = {
  name: "write-file",
  description: "创建或覆写文本文件。只在用户明确要求创建文件或写入内容时才调用。",
      input_examples: [
        { description: "创建笔记文件", args: { path: "C:\Users\asus\Documents\笔记.txt", content: "今日笔记内容" } },
      ],
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "文件完整路径" },
      content: { type: "string", description: "要写入的内容" },
    },
    required: ["path", "content"],
  },
  execute: async (args) => {
    const filePath = String(args.path);
    const content = String(args.content);
    const err = isPathSafe(filePath);
    if (err) return `PERMISSION_REQUIRED::${err}::`;

    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content, "utf-8");
      return `✅ 已写入: ${filePath} (${formatSize(content.length)})`;
    } catch (e: any) {
      return `写入失败: ${e.message}`;
    }
  },
};

export const deleteFileTool: ToolDef = {
  name: "delete-file",
  description: "将文件移入回收站（不永久删除，可恢复）。只在用户明确要求删除文件时才调用。",
      input_examples: [
        { description: "删除临时文件", args: { path: "C:\Users\asus\Downloads\temp.txt" } },
      ],
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "要删除的文件完整路径" },
    },
    required: ["path"],
  },
  execute: async (args) => {
    const filePath = String(args.path);
    if (!fs.existsSync(filePath)) return `文件不存在: ${filePath}`;
    const err = isPathSafe(filePath);
    if (err) return `PERMISSION_REQUIRED::${err}::`;

    try {
      const trashPath = moveToTrash(filePath);
      return `✅ 已移入回收站: ${path.basename(filePath)}\n回收站位置: ${TRASH_DIR}`;
    } catch (e: any) {
      return `删除失败: ${e.message}`;
    }
  },
};

/** 文件内容总结 / 翻译 / 格式化 */
export const summarizeFileTool: ToolDef = {
  name: "summarize-file",
  description: "读取文本文件并调用 AI 进行总结、翻译或格式化。适合用户说'帮我总结这个文件'、'翻译这份文档'、'把这个 txt 整理成表格'等场景。",
  input_examples: [
    { description: "总结报告内容", args: { path: "C:\\Users\\asus\\Documents\\报告.txt", task: "总结" } },
    { description: "翻译英文文档", args: { path: "C:\\Users\\asus\\Desktop\\readme.md", task: "翻译成中文" } },
  ],
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "文件完整路径" },
      task: { type: "string", description: "处理任务，如：总结要点、翻译成中文、格式化为表格、提取关键信息" },
    },
    required: ["path", "task"],
  },
  execute: async (args) => {
    const filePath = String(args.path);
    const task = String(args.task);
    if (!fs.existsSync(filePath)) return `文件不存在: ${filePath}`;
    try {
      const stat = fs.statSync(filePath);
      const maxLen = 30 * 1024;
      const content = fs.readFileSync(filePath, "utf-8").slice(0, maxLen);
      const truncated = stat.size > maxLen ? "（文件过大，仅读取前 30KB）\n" : "";

      const client = new OpenAI({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      });
      const response = await client.chat.completions.create({
        model: resolveModel(process.env.DEEPSEEK_MODEL),
        messages: [
          { role: "system", content: `你是文件处理助手。对用户提供的文件内容执行：${task}。简洁输出结果。` },
          { role: "user", content: `文件: ${path.basename(filePath)}\n\n${truncated}${content}` },
        ],
        temperature: 0.3,
        max_tokens: 1024,
      });
      return response.choices[0]?.message?.content || "（AI 未返回内容）";
    } catch (e: any) {
      return `处理失败: ${e.message}`;
    }
  },
};

export const parseFileTool: ToolDef = {
  name: "parse-file",
  description: "解析 PDF、Word(docx)、PPT(pptx) 文件，提取文本内容。用户说打开这个PDF、看看这个Word文档、这个PPT说了什么时调用。",
  input_examples: [
    { description: "解析PDF论文", args: { path: "C:\Users\asus\Documents\论文.pdf" } },
    { description: "提取Word文档内容", args: { path: "C:\Users\asus\Desktop\报告.docx" } },
  ],
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "文件完整路径" },
    },
    required: ["path"],
  },
  execute: async (args) => {
    const fp = String(args.path);
    if (!fs.existsSync(fp)) return "文件不存在: " + fp;
    const ext = path.extname(fp).toLowerCase();
    try {
      if (ext === ".pdf") {
        const pdf = require("pdf-parse");
        const buf = fs.readFileSync(fp);
        const data = await pdf(buf);
        const text = (data.text || "").trim();
        if (!text && data.numpages === 0) return "PDF 解析失败: 文件可能损坏或为空。";
        if (!text) return "PDF 解析失败: 该文件可能是扫描图片版 PDF，无法提取文本。建议截图贴给我。";
        return "PDF 内容 (共 " + data.numpages + " 页):\n" + text.slice(0, 50 * 1024);
      }
      if (ext === ".docx") {
        const mammoth = require("mammoth");
        const result = await mammoth.extractRawText({ path: fp });
        return "Word 文档内容:\n" + result.value.slice(0, 50 * 1024);
      }
      if (ext === ".pptx") {
        const zip = new AdmZip(fp);
        const texts: string[] = [];
        const re = new RegExp("<a:t[^>]*>([^<]*)<\\/a:t>", "g");
        const entries = zip.getEntries().filter(e => e.entryName.startsWith("ppt/slides/slide"));
        for (const entry of entries) {
          const xml = entry.getData().toString("utf-8");
          let m;
          while ((m = re.exec(xml)) !== null) {
            if (m[1]) texts.push(m[1]);
          }
        }
        return "PPT 内容:\n" + texts.join("\n").slice(0, 50 * 1024);
      }
      return "不支持的文件格式: " + ext + "。支持 PDF、DOCX、PPTX。";
    } catch (e: any) {
      return `解析 ${ext} 文件失败: ${e.message}。该文件可能已损坏或使用了不支持的编码格式。`;
    }
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
  register(moveFileTool);
  register(copyFileTool);
  register(newFolderTool);
  register(writeFileTool);
  register(deleteFileTool);
  register(summarizeFileTool);
  register(parseFileTool);
}
