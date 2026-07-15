// 对话数据层 — 独立于 React 组件
// SSE 流往这里写，ChatPanel 从这里读。切对话不打断流。

export interface ConvMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  skillName?: string;
}

interface ConvState {
  messages: ConvMessage[];
  streaming: boolean;
}

// 全局对话状态 Map
const store = new Map<string, ConvState>();
let version = 0;
const listeners = new Set<() => void>();

function getOrCreate(id: string): ConvState {
  if (!store.has(id)) {
    store.set(id, { messages: [], streaming: false });
  }
  return store.get(id)!;
}

export function getMessages(id: string): ConvMessage[] {
  return getOrCreate(id).messages;
}

export function isStreaming(id: string): boolean {
  return getOrCreate(id).streaming;
}

export function setMessages(id: string, msgs: ConvMessage[]) {
  getOrCreate(id).messages = msgs;
  flushAndNotify();
}

export function appendMessage(id: string, msg: ConvMessage) {
  const s = getOrCreate(id);
  s.messages.push(msg);
  flushAndNotify();
}

// delta 批处理 — 每 60ms flush 一次，避免高频 re-render
const deltaBuffers = new Map<string, string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushDeltas() {
  flushTimer = null;
  deltaBuffers.forEach((text, id) => {
    const s = getOrCreate(id);
    if (s.messages.length > 0) {
      s.messages[s.messages.length - 1] = {
        ...s.messages[s.messages.length - 1],
        content: s.messages[s.messages.length - 1].content + text,
      };
    }
  });
  deltaBuffers.clear();
  notify();
}

export function appendToLast(id: string, text: string) {
  const s = getOrCreate(id);
  if (s.messages.length === 0) return;
  deltaBuffers.set(id, (deltaBuffers.get(id) || "") + text);
  if (!flushTimer) {
    flushTimer = setTimeout(flushDeltas, 60);
  }
}

// 非 delta 更新时先 flush 积压的 delta
function flushAndNotify() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  flushDeltas();
}

export function setStreaming(id: string, v: boolean) {
  getOrCreate(id).streaming = v;
  flushAndNotify();
}

export function clearConversation(id: string) {
  store.delete(id);
  flushAndNotify();
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  version++;
  listeners.forEach((fn) => fn());
}
