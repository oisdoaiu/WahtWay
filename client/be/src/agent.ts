// Agent 核心 — V0.15 实时流式 Agentic Loop + Tool Calling
// 职责：匹配 Skill → LLM+Tool 循环 → 流式返回

import OpenAI from "openai";
import { Skill, AgentResult } from "./types";
import { registeredSkills } from "./skills/loader";
import { matchSkillByKeywords, GENERAL_PROMPT } from "./skills/matcher";
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
let _model: string | null = null;
function getModel(override?: string): string {
  return override || _model || process.env.DEEPSEEK_getModel() || "deepseek-chat";
}
export function setModel(m: string) { _model = m; }
export function getCurrentModel(): string { return getModel(); }
const MAX_TOOL_ROUNDS = 10;

async function matchSkill(userMessage: string): Promise<Skill | null> {
  return matchSkillByKeywords(userMessage, registeredSkills);
}

// ---- 流式 Agentic Loop ----

export interface StreamEvent {
  type: "skill_matched" | "tool_call" | "tool_result" | "delta" | "thinking" | "stats" | "done";
  data: unknown;
}

export interface AgentStats {
  totalTokens: number;
  totalTime: number;
  rounds: number;
  toolCalls: number;
  model: string;
}

function toolPolicy(): string {
  return `
## 系统信息
- 用户主目录: ${require("os").homedir()}
- 桌面路径: ${require("os").homedir() + "\\Desktop"}
- 文档路径: ${require("os").homedir() + "\\Documents"}
- WahtWay 回收站: ${require("os").homedir() + "\\.wahtway-trash"}（被删除的文件移到这里，不是 Windows 系统回收站）

## 你的基本能力（和说话一样自然，想到就用）
- 你能看到用户电脑上的文件：list-files / read-file / search-files / file-info
- 你能操作文件：move-file / copy-file / new-folder / write-file / delete-file
- 这些不是"需要决定要不要用的工具"——是你的眼睛和手
- 用户说"看看桌面"、"回收站里有什么"、"找一下报告"——和呼吸一样自然地调用
- 只有"你好"、"谢谢"、"再见"这种纯社交场合才不操作文件

## 你的记忆能力
- 你可以在 ${require("os").homedir()}\\.wahtway-notes\\ 目录下读写 .md 笔记文件
- 遇到复杂任务时，先写笔记记录分析结果，下次对话可以直接读笔记，不用重复扫描
- 用户信息、偏好、之前做过什么都可以记在笔记里，形成长期记忆
- 用 write-file 记笔记，用 read-file 读笔记`.trim();
}

async function* agenticLoopStream(
  systemPrompt: string,
  userMessage: string,
  history?: { role: string; content: string }[],
  traceId?: string,
  allowedTools?: string[],
  workspace?: string
): AsyncGenerator<StreamEvent> {
  const log = logger(traceId || "no-trace", "agent");
  const startTime = Date.now();
  let totalRoundTokens = 0;
  let toolCallCount = 0;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt + "\n\n" + toolPolicy() },
  ];

  if (history) {
    for (const h of history) {
      if (h.role === "user" || h.role === "assistant") {
        messages.push(h as any);
      }
    }
  }

  messages.push({ role: "user", content: userMessage });

  const tools = formatToolsForLLM(allowedTools);

  function buildStats(round: number): AgentStats {
    return {
      totalTokens: totalRoundTokens,
      totalTime: Date.now() - startTime,
      rounds: round + 1,
      toolCalls: toolCallCount,
      model: getModel(),
    };
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    log.info("llm_call_stream", { round, toolsAvailable: tools.length });

    const stream = await getClient().chat.completions.create({
      model: getModel(),
      messages,
      tools: tools.length > 0 ? tools as any : undefined,
      temperature: 0.7,
      max_tokens: 2048,
      stream: true,
      stream_options: { include_usage: true } as any,
    });

    let content = "";
    const toolCallMap = new Map<number, { id: string; name: string; args: string }>();
    let hasToolCalls = false;
    let roundTokens = 0;

    for await (const chunk of stream) {
      // 提取 usage（DeepSeek stream 末尾可能返回）
      if ((chunk as any).usage) {
        const u = (chunk as any).usage;
        roundTokens = u.total_tokens || 0;
      }

      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if ((delta as any).reasoning_content) {
        yield { type: "thinking", data: (delta as any).reasoning_content };
      }

      if (delta.content) {
        content += delta.content;
        yield { type: "delta", data: delta.content };
      }

      if (delta.tool_calls) {
        hasToolCalls = true;
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallMap.has(idx)) {
            toolCallMap.set(idx, {
              id: tc.id || "",
              name: tc.function?.name || "",
              args: "",
            });
          }
          const entry = toolCallMap.get(idx)!;
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name = tc.function.name;
          if (tc.function?.arguments) entry.args += tc.function.arguments;
        }
      }
    }

    totalRoundTokens += roundTokens;

    if (hasToolCalls && toolCallMap.size > 0) {
      const toolCalls = Array.from(toolCallMap.values());
      toolCallCount += toolCalls.length;

      messages.push({
        role: "assistant",
        content: content || null,
        tool_calls: toolCalls.map((tc, i) => ({
          id: tc.id || `call_${i}`,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.args },
        })),
      } as any);

      for (const tc of toolCalls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.args); } catch {}

        log.info("tool_call", { tool: tc.name, args });
        yield { type: "tool_call", data: { toolName: tc.name, args } };

        const tool = getTool(tc.name);
        const result = tool
          ? await tool.execute(args)
          : `错误: 未知 Tool "${tc.name}"`;

        yield {
          type: "tool_result",
          data: { toolName: tc.name, result: result.slice(0, 500) },
        };

        messages.push({
          role: "tool",
          tool_call_id: tc.id || `call_${Array.from(toolCallMap.keys()).indexOf(tc.name)}`,
          content: result,
        } as any);
      }

      // 每轮结束后推送实时统计
      yield { type: "stats", data: buildStats(round) };
      continue;
    }

    // 纯文本回复 → 结束
    yield { type: "stats", data: buildStats(round) };
    yield { type: "done", data: { fullContent: content, stats: buildStats(round) } };
    return;
  }

  const finalStats = buildStats(MAX_TOOL_ROUNDS);
  yield { type: "done", data: { fullContent: "已达到最大工具调用轮数", stats: finalStats } };
}

// ---- 流式执行 Skill ----

export async function* executeSkillStream(
  skill: Skill,
  userMessage: string,
  history?: { role: string; content: string }[],
  traceId?: string,
  workspace?: string
): AsyncGenerator<StreamEvent> {
  const log = logger(traceId || "no-trace", "skill");
  log.info("matched", { skillId: skill.id, skillName: skill.name });

  yield {
    type: "skill_matched",
    data: { skillName: skill.name, skillId: skill.id },
  };

  for await (const event of agenticLoopStream(skill.systemPrompt, userMessage, history, traceId, skill.allowedTools, workspace)) {
    yield event;
  }
}

// ---- 入口 ----

export async function runAgent(userMessage: string): Promise<AgentResult> {
  const skill = await matchSkill(userMessage);
  if (!skill) throw new Error("未找到合适的 Skill");
  const gen = agenticLoopStream(skill.systemPrompt, userMessage);
  let output = "";
  for await (const ev of gen) {
    if (ev.type === "delta") output += ev.data as string;
  }
  return {
    skillName: skill.name, skillId: skill.id, output,
    tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
}

export async function runAgentStream(
  userMessage: string,
  history?: { role: string; content: string }[],
  traceId?: string,
  model?: string,
  skillId?: string,
  workspace?: string
): Promise<AsyncGenerator<StreamEvent>> {
  if (model) setModel(model);
  const log = logger(traceId || "no-trace", "agent");
  log.info("start", { msgLen: userMessage.length, mode: skillId || "auto" });

  let skill: Skill | null = null;

  if (skillId) {
    skill = registeredSkills.find((s) => s.id === skillId) || null;
    if (!skill) log.warn("skill_not_found", { skillId });
  }

  if (!skill) {
    skill = await matchSkill(userMessage);
  }

  if (!skill) {
    const general: Skill = {
      id: "general", name: "闲聊", description: "通用对话",
      systemPrompt: GENERAL_PROMPT,
      input: { type: "object", properties: {} },
      output: { type: "object", properties: {} },
      requiredTools: [],
    };
    return executeSkillStream(general, userMessage, history, traceId, undefined, workspace);
  }

  return executeSkillStream(skill, userMessage, history, traceId, undefined, workspace);
}

export { matchSkill };
