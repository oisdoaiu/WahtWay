// 结构化调试日志 + 自动导出文件
// 每条日志带 traceId，同时输出到控制台和文件
// 文件路径: be/data/logs/wahtway.log（自动轮转，最大 1MB × 3 份）

import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";

type Level = "DEBUG" | "INFO" | "WARN" | "ERROR";

interface LogEntry {
  ts: string;
  lv: Level;
  mod: string;
  tid: string;
  evt: string;
  [key: string]: any;
}

const LEVELS: Record<Level, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const currentLevel = (process.env.SW_LOG || "INFO") as Level;
const MAX_SIZE = 1 * 1024 * 1024; // 1MB
const MAX_FILES = 3;

// 日志文件目录
const LOG_DIR = (() => {
  const candidates = [
    path.join(process.cwd(), "data", "logs"),
    path.resolve(__dirname, "../data/logs"),
  ];
  for (const d of candidates) {
    try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); return d; } catch {}
  }
  return candidates[0];
})();

const LOG_FILE = path.join(LOG_DIR, "wahtway.log");

function shouldLog(level: Level): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function now(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 23);
}

export function createTraceId(): string {
  return randomUUID().slice(0, 8);
}

function rotateLog() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const stat = fs.statSync(LOG_FILE);
    if (stat.size < MAX_SIZE) return;

    // 轮转: wahtway.log → wahtway.1.log → wahtway.2.log
    for (let i = MAX_FILES - 1; i >= 1; i--) {
      const old = path.join(LOG_DIR, `wahtway.${i}.log`);
      const next = path.join(LOG_DIR, `wahtway.${i + 1}.log`);
      try { if (fs.existsSync(old)) fs.renameSync(old, next); } catch {}
    }
    const bak = path.join(LOG_DIR, "wahtway.1.log");
    try { fs.renameSync(LOG_FILE, bak); } catch {}
  } catch {}
}

function writeToFile(line: string) {
  try {
    rotateLog();
    fs.appendFileSync(LOG_FILE, line + "\n", "utf-8");
  } catch {}
}

export function log(
  traceId: string,
  module: string,
  event: string,
  data?: Record<string, unknown>,
  level: Level = "INFO"
) {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    ts: now(),
    lv: level,
    mod: module,
    tid: traceId,
    evt: event,
    ...data,
  };

  // 控制台输出
  const msg = `[${entry.ts}] [${entry.lv}] [${entry.mod}] [${entry.tid}] ${entry.evt}`;
  const extra = { ...entry };
  delete extra.ts; delete extra.lv; delete extra.mod; delete extra.tid; delete extra.evt;

  if (Object.keys(extra).length > 0) {
    console.log(msg, extra);
  } else {
    console.log(msg);
  }

  // 写入文件（JSON 行格式，方便程序解析，人也可读）
  writeToFile(JSON.stringify(entry));
}

export function logger(traceId: string, module: string) {
  return {
    debug: (event: string, data?: Record<string, unknown>) => log(traceId, module, event, data, "DEBUG"),
    info:  (event: string, data?: Record<string, unknown>) => log(traceId, module, event, data, "INFO"),
    warn:  (event: string, data?: Record<string, unknown>) => log(traceId, module, event, data, "WARN"),
    error: (event: string, data?: Record<string, unknown>) => log(traceId, module, event, data, "ERROR"),
  };
}
