import { ConversationTurn } from "../types";

export type FollowUpSignal = "analyze" | "positive" | "unrelated";

const CONTEXT_REFERENCE = /(?:继续|接着|还是按|按照刚才|按刚才|按之前|上次|刚才|之前|前面|照旧|同样的|那个|基于(?:此|这|上面)|在此基础上|再改|重新来|换成)/i;
const CORRECTION_OR_RETRY = /(?:不是|不对|错了|搞错|我说的是|我的意思是|应该是|没有按|没按|漏了|遗漏|不要|别再|太长|太短|太多|太少|重来|重新|再生成|再写|再做|改一下|修改|格式不对|不符合)/i;
const ADDED_CONSTRAINT = /(?:另外|还要|还得|记得|必须|需要限制|限制在|要求是|请按|改成|换成|补充|再加|少了|加上|去掉)/i;
const POSITIVE_CONTINUATION = /^(?:好|好的|可以|行|没问题|就这样|继续|下一步|接着|然后)(?:[，。！!、\s]|$)/i;

function normalizedText(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

function bigrams(value: string): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index < value.length - 1; index++) {
    result.add(value.slice(index, index + 2));
  }
  return result;
}

function looksRepeated(previousMessage: string, nextMessage: string): boolean {
  const previous = normalizedText(previousMessage);
  const next = normalizedText(nextMessage);
  if (previous.length < 6 || next.length < 6) return false;
  if (previous.includes(next) || next.includes(previous)) return true;
  const previousPairs = bigrams(previous);
  const nextPairs = bigrams(next);
  if (previousPairs.size === 0 || nextPairs.size === 0) return false;
  let intersection = 0;
  for (const pair of previousPairs) {
    if (nextPairs.has(pair)) intersection += 1;
  }
  return intersection / Math.min(previousPairs.size, nextPairs.size) >= 0.6;
}

export function hasUsefulContext(
  userMessage: string,
  history?: { role: string; content: string }[]
): boolean {
  const turns = (history || []).filter(
    (turn): turn is ConversationTurn =>
      (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string"
  );
  return turns.length > 0 && (
    CONTEXT_REFERENCE.test(userMessage) ||
    CORRECTION_OR_RETRY.test(userMessage) ||
    ADDED_CONSTRAINT.test(userMessage) ||
    POSITIVE_CONTINUATION.test(userMessage.trim())
  );
}

export function classifyFollowUp(
  previousUserMessage: string,
  nextUserMessage: string
): FollowUpSignal {
  const next = nextUserMessage.trim();
  if (!next) return "unrelated";
  if (CORRECTION_OR_RETRY.test(next) || ADDED_CONSTRAINT.test(next)) return "analyze";
  if (looksRepeated(previousUserMessage, next)) return "analyze";
  if (POSITIVE_CONTINUATION.test(next)) return "positive";
  return "unrelated";
}
