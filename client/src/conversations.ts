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
  notify();
}

export function appendMessage(id: string, msg: ConvMessage) {
  const s = getOrCreate(id);
  s.messages.push(msg);
  notify();
}

export function appendToLast(id: string, text: string) {
  const s = getOrCreate(id);
  if (s.messages.length > 0) {
    s.messages[s.messages.length - 1] = {
      ...s.messages[s.messages.length - 1],
      content: s.messages[s.messages.length - 1].content + text,
    };
    notify();
  }
}

export function setStreaming(id: string, v: boolean) {
  getOrCreate(id).streaming = v;
  notify();
}

export function clearConversation(id: string) {
  store.delete(id);
  notify();
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  version++;
  listeners.forEach((fn) => fn());
}
