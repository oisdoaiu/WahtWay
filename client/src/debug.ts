// 调试开关 + 事件追踪

export const DEBUG = {
  get on() {
    return localStorage.getItem("debug") === "1";
  },
  set on(v: boolean) {
    localStorage.setItem("debug", v ? "1" : "0");
  },
  log(...args: unknown[]) {
    if (this.on) console.log("[DEBUG]", ...args);
  },
};

// 调试事件历史（最多 50 条）
interface DebugEvent {
  ts: number;
  type: string;
  data: string;
}
const events: DebugEvent[] = [];
let listeners: Array<() => void> = [];

export function addDebugEvent(type: string, data: string) {
  if (!DEBUG.on) return;
  events.unshift({ ts: Date.now(), type, data });
  if (events.length > 50) events.pop();
  listeners.forEach((fn) => fn());
}

export function getDebugEvents(): DebugEvent[] {
  return events;
}

export function clearDebugEvents() {
  events.length = 0;
  listeners.forEach((fn) => fn());
}

export function onDebugEvents(fn: () => void) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}
