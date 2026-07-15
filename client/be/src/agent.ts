// Agent 核心 — V0.9 Agentic Loop + Tool Calling
// 职责：匹配 Skill → LLM+Tool 循环 → 流式返回

import OpenAI from "openai";
import { Skill, AgentResult, TokenUsage, ToolDef } from "./types";
import { registeredSkills } from "./skills/loader";
import { matchSkillByKeywords } from "./skills/matcher";
import { getTool, formatToolsForLLM } from "./tools/registry";
import { logger } from "./logger";

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    });
  }
  return _client;
}
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const MAX_TOOL_ROUNDS = 10;

async function matchSkill(userMessage: string): Promise<Skill | null> {
  return matchSkillByKeywords(userMessage, registeredSkills);
}

// ---- 非流式 Agentic Loop ----
async function agenticLoop(
  systemPrompt: string,
  userMessage: string,
  history?: { role: string; content: string }[],
  traceId?: string,
  onToolCall?: (name: string, args: Record<string, unknown>) => void,
  onToolResult?: (name: string, result: string) => void
): Promise<string> {
  const log = logger(traceId || "no-trace", "agent");
  const toolPolicy = `
## 系统信息
- 用户主目录: ${require("os").homedir()}
- 桌面路径: ${require("os").homedir() + "\\Desktop"}
- 文档路径: ${require("os").homedir() + "\\Documents"}

## 工具使用规范（必须遵守）
- 你有一组系统工具可用，每个工具的 description 已经说明了适用场景
- 只在用户明确要求执行对应操作时才调用工具，不要在闲聊、问候、建议类对话中自动调用
- 如果你不确定是否需要工具，就不要调用——先文字回复，等用户明确要求
- 工具执行结果会回传给你，请用自然语言整理后告知用户`.trim();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt + "\n\n" + toolPolicy },
  ];

  // 注入历史对话（V0.10 多轮记忆）
  if (history) {
    for (const h of history) {
      if (h.role === "user" || h.role === "assistant") {
        messages.push(h as any);
      }
    }
  }

  // 当前用户消息
  messages.push({ role: "user", content: userMessage });

  // 所有已注册 Tool 始终可用，LLM 自行判断是否需要调用
  const tools = formatToolsForLLM();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    log.info("llm_call", { round, toolsAvailable: tools.length });
    const t0 = Date.now();
    const response = await getClient().chat.completions.create({
      model: MODEL,
      messages,
      tools: tools.length > 0 ? tools as any : undefined,
      temperature: 0.7,
      max_tokens: 2048,
      stream: false,
    });
    const elapsed = Date.now() - t0;

    const msg = response.choices[0]?.message;
    if (!msg) return "（无回复）";
    log.info("llm_response", {
      round,
      elapsed: `${elapsed}ms`,
      hasToolCalls: !!(msg.tool_calls?.length),
      contentLen: msg.content?.length || 0,
      tokens: response.usage?.total_tokens,
    });

    // 如果有 tool_calls，执行它们
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      // 添加 assistant 消息（含 tool_calls）
      messages.push({
        role: "assistant",
        content: msg.content || "",
        tool_calls: msg.tool_calls as any,
      } as any);

      for (const tc of msg.tool_calls) {
        const toolName = tc.function.name;
        const args = JSON.parse(tc.function.arguments || "{}");
        log.info("tool_call", { tool: toolName, args });

        onToolCall?.(toolName, args);

        const tt0 = Date.now();
        const tool = getTool(toolName);
        const result = tool
          ? await tool.execute(args)
          : `错误: 未知 Tool "${toolName}"`;
        log.info("tool_result", {
          tool: toolName,
          elapsed: `${Date.now() - tt0}ms`,
          resultLen: result.length,
          resultPreview: result.slice(0, 100),
        });

        onToolResult?.(toolName, result);

        // 添加 tool 结果消息
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        } as any);
      }
      continue; // 继续下一轮，让 LLM 处理 Tool 结果
    }

    // 纯文本回复，结束循环
    return msg.content || "（空回复）";
  }

  return "已达到最大工具调用轮数，请尝试更具体的问题。";
}

// ---- 流式执行 Skill（含 Tool Calling）----

export interface StreamEvent {
  type: "skill_matched" | "tool_call" | "tool_result" | "delta" | "done";
  data: unknown;
}

export async function* executeSkillStream(
  skill: Skill,
  userMessage: string,
  history?: { role: string; content: string }[],
  traceId?: string
): AsyncGenerator<StreamEvent> {
  const log = logger(traceId || "no-trace", "skill");
  log.info("matched", { skillId: skill.id, skillName: skill.name });

  // 推送 Skill 匹配信息
  yield {
    type: "skill_matched",
    data: { skillName: skill.name, skillId: skill.id },
  };

  // Agentic Loop（非流式），收集 tool 调用事件
  const toolEvents: StreamEvent[] = [];

  const finalText = await agenticLoop(
    skill.systemPrompt,
    userMessage,
    history,
    traceId,
    (name, args) => {
      toolEvents.push({ type: "tool_call", data: { toolName: name, args } });
    },
    (name, result) => {
      toolEvents.push({
        type: "tool_result",
        data: { toolName: name, result: result.slice(0, 500) },
      });
    }
  );

  // 先推 Tool 事件
  for (const ev of toolEvents) {
    yield ev;
  }

  // 把最终回复按字符拆成 delta 推送（模拟流式效果）
  for (const char of finalText) {
    yield { type: "delta", data: char };
    await sleep(15); // 模拟打字机节奏
  }

  yield { type: "done", data: { fullContent: finalText } };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- 入口 ----

export async function runAgent(userMessage: string): Promise<AgentResult> {
  const skill = await matchSkill(userMessage);
  if (!skill) throw new Error("未找到合适的 Skill");
  const output = await agenticLoop(skill.systemPrompt, userMessage);
  return { skillName: skill.name, skillId: skill.id, output, tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
}

export async function runAgentStream(
  userMessage: string,
  history?: { role: string; content: string }[],
  traceId?: string
): Promise<AsyncGenerator<StreamEvent>> {
  const log = logger(traceId || "no-trace", "agent");
  log.info("start", { msgLen: userMessage.length });

  const skill = await matchSkill(userMessage);
  if (!skill) {
    log.warn("no_match", { message: userMessage.slice(0, 50) });
    throw new Error("未找到合适的 Skill，请尝试更明确的描述。");
  }
  return executeSkillStream(skill, userMessage, history, traceId);
}

export { matchSkill };
