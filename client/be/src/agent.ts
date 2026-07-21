// Agent 核心 — V0.15 实时流式 Agentic Loop + Tool Calling
// 职责：匹配 Skill → LLM+Tool 循环 → 流式返回

import OpenAI from "openai";
import { AgentStatsSnapshot, NeedSnapshot, Skill, AgentResult } from "./types";
import { registeredSkills } from "./skills/loader";
import { matchSkillByKeywords, matchSkillWithNeed, GENERAL_PROMPT } from "./skills/matcher";
import {
  beginSkillObservation,
  finishSkillObservation,
  scheduleDelayedObservation,
} from "./skills/learning-engine";
import { getTool, formatToolsForLLM } from "./tools/registry";
import { logger } from "./logger";
import { resolveModel } from "./models";
import { createAgentRunCheckpoint, saveAgentRunCheckpoint } from "./agent-runs/repository";
import { AgentRunCheckpoint, SerializedToolCall } from "./agent-runs/types";
import { executeApprovedTool, parsePendingApproval } from "./agent-runs/approval";

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
  return resolveModel(override || _model || process.env.DEEPSEEK_MODEL);
}
export function setModel(m: string) { _model = resolveModel(m); }
export function getCurrentModel(): string { return getModel(); }
const MAX_TOOL_ROUNDS = 10;

async function matchSkill(userMessage: string): Promise<Skill | null> {
  return matchSkillByKeywords(userMessage, registeredSkills);
}

// ---- 流式 Agentic Loop ----

export interface StreamEvent {
  type: "skill_matched" | "tool_call" | "tool_result" | "approval_required" | "delta" | "thinking" | "stats" | "done";
  data: unknown;
}

export interface AgentStats {
  totalTokens: number;
  totalTime: number;
  rounds: number;
  toolCalls: number;
  model: string;
}

export interface AgentRunMetadata {
  conversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  needSnapshot?: NeedSnapshot;
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
  workspace?: string,
  metadata?: AgentRunMetadata,
  checkpoint?: AgentRunCheckpoint,
  approved?: boolean
): AsyncGenerator<StreamEvent> {
  if (checkpoint?.model) setModel(checkpoint.model);
  const log = logger(traceId || "no-trace", "agent");
  const startTime = checkpoint ? Date.parse(checkpoint.startedAt) : Date.now();
  let totalRoundTokens = checkpoint?.totalRoundTokens || 0;
  let toolCallCount = checkpoint?.toolCallCount || 0;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = checkpoint
    ? checkpoint.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[]
    : [
    { role: "system", content: systemPrompt + "\n\n" + toolPolicy() },
  ];

  if (!checkpoint && history) {
    for (const h of history) {
      if (h.role === "user" || h.role === "assistant") {
        messages.push(h as any);
      }
    }
  }

  if (!checkpoint) messages.push({ role: "user", content: userMessage });

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

  async function persistApproval(
    pending: NonNullable<ReturnType<typeof parsePendingApproval>>,
    calls: SerializedToolCall[],
    nextIndex: number,
    round: number
  ): Promise<AgentRunCheckpoint> {
    const state = {
      conversationId: metadata?.conversationId,
      userMessageId: metadata?.userMessageId,
      assistantMessageId: metadata?.assistantMessageId,
      traceId: traceId || "no-trace",
      model: getModel(),
      systemPrompt,
      messages: messages as unknown[],
      allowedTools,
      workspace,
      round,
      totalRoundTokens,
      toolCallCount,
      startedAt: new Date(startTime).toISOString(),
      currentBatch: { calls, nextIndex },
      pendingApproval: pending,
    };
    if (!checkpoint) return createAgentRunCheckpoint(state);
    return saveAgentRunCheckpoint({
      ...checkpoint,
      ...state,
      status: "waiting_approval",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  function approvalEvent(state: AgentRunCheckpoint): StreamEvent {
    return {
      type: "approval_required",
      data: {
        runId: state.id,
        conversationId: state.conversationId,
        kind: state.pendingApproval.kind,
        toolName: state.pendingApproval.toolName,
        reason: state.pendingApproval.reason,
        target: state.pendingApproval.target,
        expiresAt: state.expiresAt,
      },
    };
  }

  let initialRound = checkpoint?.round || 0;
  if (checkpoint) {
    const calls = checkpoint.currentBatch.calls;
    for (let index = checkpoint.currentBatch.nextIndex; index < calls.length; index++) {
      const tc = calls[index];
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.argumentsJson); } catch {}
      yield { type: "tool_call", data: { toolName: tc.name, args } };
      const result = index === checkpoint.currentBatch.nextIndex
        ? approved
          ? await executeApprovedTool(checkpoint.pendingApproval)
          : "The user rejected this tool call. Do not retry the same operation; explain the impact and offer a safe alternative."
        : await (getTool(tc.name)?.execute(args) ?? Promise.resolve(`Error: unknown Tool "${tc.name}"`));
      const pending = parsePendingApproval(result, tc.id, tc.name, args);
      if (pending) {
        yield approvalEvent(await persistApproval(pending, calls, index, initialRound));
        return;
      }
      yield { type: "tool_result", data: { toolName: tc.name, result: result.slice(0, 500) } };
      messages.push({ role: "tool", tool_call_id: tc.id, content: result } as any);
    }
    yield { type: "stats", data: buildStats(initialRound) };
    initialRound += 1;
  }

  for (let round = initialRound; round < MAX_TOOL_ROUNDS; round++) {
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
      const toolCalls: SerializedToolCall[] = Array.from(toolCallMap.values()).map((tc, index) => ({
        id: tc.id || `call_${index}`,
        name: tc.name,
        argumentsJson: tc.args,
      }));
      toolCallCount += toolCalls.length;

      messages.push({
        role: "assistant",
        content: content || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.argumentsJson },
        })),
      } as any);

      for (let index = 0; index < toolCalls.length; index++) {
        const tc = toolCalls[index];
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.argumentsJson); } catch {}

        log.info("tool_call", { tool: tc.name, argKeys: Object.keys(args) });
        yield { type: "tool_call", data: { toolName: tc.name, args } };

        const tool = getTool(tc.name);
        const result = tool
          ? await tool.execute(args)
          : `错误: 未知 Tool "${tc.name}"`;

        const pending = parsePendingApproval(result, tc.id, tc.name, args);
        if (pending) {
          yield approvalEvent(await persistApproval(pending, toolCalls, index, round));
          return;
        }

        yield {
          type: "tool_result",
          data: { toolName: tc.name, result: result.slice(0, 500) },
        };

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
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

export function resumeAgentRun(
  checkpoint: AgentRunCheckpoint,
  approved: boolean
): AsyncGenerator<StreamEvent> {
  return agenticLoopStream(
    checkpoint.systemPrompt,
    "",
    undefined,
    checkpoint.traceId,
    checkpoint.allowedTools,
    checkpoint.workspace,
    {
      conversationId: checkpoint.conversationId,
      userMessageId: checkpoint.userMessageId,
      assistantMessageId: checkpoint.assistantMessageId,
    },
    checkpoint,
    approved
  );
}

// ---- 流式执行 Skill ----

export async function* executeSkillStream(
  skill: Skill,
  userMessage: string,
  history?: { role: string; content: string }[],
  traceId?: string,
  workspace?: string,
  metadata?: AgentRunMetadata
): AsyncGenerator<StreamEvent> {
  const log = logger(traceId || "no-trace", "skill");
  log.info("matched", { skillId: skill.id, skillName: skill.name });

  let runId: string | undefined;
  if (skill.id !== "general") {
    try {
      const run = await beginSkillObservation({
        traceId: traceId || "no-trace",
        skill,
        userMessage,
        history,
        conversationId: metadata?.conversationId,
        userMessageId: metadata?.userMessageId,
        assistantMessageId: metadata?.assistantMessageId,
        needSnapshot: metadata?.needSnapshot,
      });
      runId = run.id;
    } catch (error) {
      log.warn("observation_start_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  yield {
    type: "skill_matched",
    data: {
      skillName: skill.name,
      skillId: skill.id,
      skillVersion: skill.version || 1,
      runId,
    },
  };

  let output = "";
  let stats: AgentStatsSnapshot | undefined;
  const toolCalls: { toolName: string; ok: boolean; summary: string }[] = [];
  let status: "completed" | "aborted" | "error" = "aborted";

  try {
    for await (const event of agenticLoopStream(
      skill.systemPrompt,
      userMessage,
      history,
      traceId,
      skill.allowedTools,
      workspace,
      metadata
    )) {
      if (event.type === "delta") output += event.data as string;
      if (event.type === "stats") stats = event.data as AgentStatsSnapshot;
      if (event.type === "tool_result") {
        const data = event.data as { toolName?: string; result?: string };
        const result = typeof data.result === "string" ? data.result : "";
        const ok = !result.startsWith("错误") && !result.startsWith("PERMISSION_REQUIRED::");
        toolCalls.push({
          toolName: data.toolName || "unknown",
          ok,
          summary: ok ? "执行成功" : "执行未完成",
        });
      }
      if (event.type === "done") status = "completed";
      yield event;
    }
  } catch (error) {
    status = "error";
    throw error;
  } finally {
    if (runId) {
      finishSkillObservation(runId, { output, toolCalls, stats, status });
    }
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
  workspace?: string,
  metadata?: AgentRunMetadata
): Promise<AsyncGenerator<StreamEvent>> {
  if (model) setModel(model);
  const log = logger(traceId || "no-trace", "agent");
  log.info("start", { msgLen: userMessage.length, mode: skillId || "auto" });

  scheduleDelayedObservation(metadata?.conversationId, userMessage);

  let skill: Skill | null = null;
  let needSnapshot: NeedSnapshot | undefined;

  if (skillId) {
    skill = registeredSkills.find((s) => s.id === skillId) || null;
    if (!skill) log.warn("skill_not_found", { skillId });
  }

  if (!skill) {
    const match = await matchSkillWithNeed(userMessage, registeredSkills, history);
    skill = match.skill;
    needSnapshot = match.needSnapshot;
  }

  const runMetadata = { ...metadata, needSnapshot };

  if (!skill) {
    const general: Skill = {
      id: "general", name: "闲聊", description: "通用对话",
      systemPrompt: GENERAL_PROMPT,
      input: { type: "object", properties: {} },
      output: { type: "object", properties: {} },
      requiredTools: [],
    };
    return executeSkillStream(general, userMessage, history, traceId, workspace, runMetadata);
  }

  return executeSkillStream(skill, userMessage, history, traceId, workspace, runMetadata);
}

export { matchSkill };
