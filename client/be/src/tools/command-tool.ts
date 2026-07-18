// 命令行执行 Tool — V0.21
// 权限模型参考 Claude Code: 只读免审批 + 危险黑名单 + 复合命令拆分

import { exec } from "child_process";
import { ToolDef } from "../types";

// ---- 权限规则 ----

/** 只读命令前缀（自动放行，不弹窗） */
const READONLY_PREFIXES = [
  "dir", "ls", "cat", "type", "echo", "pwd", "cd",
  "git status", "git log", "git diff", "git branch",
  "find", "where", "which", "head", "tail", "wc",
  "date", "time", "ver", "whoami", "hostname",
  "node --version", "npm --version", "python --version", "pip --version",
  "dotnet --version", "gcc --version", "java --version",
];

/** 危险命令（永远弹窗确认，不缓存） */
const DANGEROUS_PATTERNS = [
  // Unix/Linux/Git Bash
  "sudo", "rm -rf /", "rm -rf ~", "rm -rf .", "rm -rf *",
  "chmod 777 /", "mkfs", "fdisk",
  "> /dev/", "dd if=", "mv / /dev",
  // Windows
  "format", "del /f /s", "del /s /q", "del /q /s",
  "deltree", "rmdir /s", "rd /s",
  "shutdown", "reboot", "logoff",
  "diskpart", "chkdsk", "reg", "regedit",
  "takeown", "icacls", "cacls",
  "net user", "net localgroup",
  "bcdedit", "sc ", "wmic",
];

/** 已审批命令缓存 */
const approvedCommands = new Map<string, string>();

/** 清除所有审批缓存（新对话时调用） */
export function clearApprovedCommands(): void {
  approvedCommands.clear();
}

function isReadonly(cmd: string): boolean {
  const lower = cmd.trim().toLowerCase();
  return READONLY_PREFIXES.some(p => lower.startsWith(p));
}

function isDangerous(cmd: string): boolean {
  const lower = cmd.trim().toLowerCase();
  // echo 只是打印文字，不危险
  if (lower.startsWith("echo ") || lower.startsWith("echo.")) return false;
  return DANGEROUS_PATTERNS.some(p => lower.includes(p));
}

/** 拆分复合命令（&& || ; |） */
function splitCompound(cmd: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (inQuote) {
      current += ch;
      if (ch === quoteChar) inQuote = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inQuote = true; quoteChar = ch; current += ch; continue; }
    // 检测 && || ; |
    if ((ch === "&" && cmd[i + 1] === "&") || (ch === "|" && cmd[i + 1] === "|")) {
      parts.push(current.trim());
      current = "";
      i++; // skip second char
      continue;
    }
    if (ch === ";" || (ch === "|" && cmd[i + 1] !== "|")) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts.length > 0 ? parts : [cmd.trim()];
}

// ---- 执行 ----

export function approveAndExecute(cmd: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const child = exec(cmd, { cwd, timeout: 30000, maxBuffer: 500 * 1024 }, (err, stdout, stderr) => {
      const key = cmd + "::" + cwd;
      if (err) {
        const result = `❌ 命令执行失败 (exit ${err.code}):\n${stderr || err.message}`;
        approvedCommands.set(key, result);
        resolve(result);
      } else {
        const output = [stdout, stderr].filter(Boolean).join("\n") || "(无输出)";
        const result = output.slice(0, 10 * 1024);
        approvedCommands.set(key, result);
        resolve(result);
      }
    });
  });
}

// ---- Tool 定义 ----

export const runCommandTool: ToolDef = {
  name: "run-command",
  description: `在终端中执行命令行指令。以下命令自动执行不弹窗：${READONLY_PREFIXES.slice(0, 10).join("、")}等只读命令。其他命令首次需确认，确认后缓存。危险命令(sudo/rm -rf/shutdown等)每次必弹窗。`,
  input_examples: [
    { description: "查看目录", args: { command: "dir", cwd: "C:\\Users\\asus\\project" } },
    { description: "Git 状态", args: { command: "git status", cwd: "C:\\Users\\asus\\project" } },
    { description: "运行脚本", args: { command: "python main.py", cwd: "C:\\Users\\asus\\project" } },
  ],
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "要执行的命令" },
      cwd: { type: "string", description: "工作目录（可选）" },
    },
    required: ["command"],
  },
  execute: async (args) => {
    const cmd = String(args.command);
    const cwd = args.cwd ? String(args.cwd) : require("os").homedir();

    // 只读命令直接执行
    if (isReadonly(cmd)) {
      return approveAndExecute(cmd, cwd);
    }

    // 危险命令永远弹窗
    if (isDangerous(cmd)) {
      return `PERMISSION_REQUIRED::⚠️ 危险命令需确认::${cmd}::${cwd}`;
    }

    // 复合命令：拆开后逐个检查
    const parts = splitCompound(cmd);
    if (parts.length > 1) {
      const dangerous = parts.filter(isDangerous);
      const needsApproval = parts.filter(p => !isReadonly(p) && !isDangerous(p));
      if (dangerous.length > 0) {
        return `PERMISSION_REQUIRED::复合命令含危险操作: ${dangerous.join(", ")}::${cmd}::${cwd}`;
      }
      if (needsApproval.length > 0) {
        return `PERMISSION_REQUIRED::复合命令需确认 (${needsApproval.length} 个子命令)::${cmd}::${cwd}`;
      }
    }

    // 已审批缓存
    const key = cmd + "::" + cwd;
    if (approvedCommands.has(key) && !isDangerous(cmd)) {
      return approvedCommands.get(key)!;
    }

    // 首次需确认
    return `PERMISSION_REQUIRED::即将执行命令::${cmd}::${cwd}`;
  },
};
