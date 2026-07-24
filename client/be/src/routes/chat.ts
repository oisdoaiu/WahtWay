import { randomUUID } from "crypto";
import { Router, Request, Response } from "express";
import { runAgentStream, getCurrentModel } from "../agent";
import { buildAgentContext, formatContextSections } from "../context/builder";
import { scheduleConversationSummary } from "../context/summary";
import { scheduleProfileExtraction } from "../memory/profile-extractor";
import { appendMessage, patchMessage, readConversation } from "../conversations/repository";
import { createTraceId, logger } from "../logger";
import { formatLlmError } from "../llm-errors";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  const { message, model, skillId, workspace, conversationId } = req.body;
  if (typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "请提供 message 字段" });
    return;
  }
  if (typeof conversationId !== "string" || !readConversation(conversationId)) {
    res.status(404).json({ error: "对话不存在或 conversationId 无效" });
    return;
  }

  const selectedMemoryIds = Array.isArray(req.body.selectedMemoryIds)
    ? req.body.selectedMemoryIds.filter((id: unknown): id is string => typeof id === "string").slice(0, 20)
    : [];
  const context = buildAgentContext(conversationId, message, selectedMemoryIds);
  if (!context) {
    res.status(404).json({ error: "对话不存在" });
    return;
  }

  const now = new Date().toISOString();
  const userMessageId = typeof req.body.userMessageId === "string" && req.body.userMessageId
    ? req.body.userMessageId.slice(0, 100)
    : randomUUID();
  const assistantMessageId = typeof req.body.assistantMessageId === "string" && req.body.assistantMessageId
    ? req.body.assistantMessageId.slice(0, 100)
    : randomUUID();
  appendMessage(conversationId, {
    id: userMessageId,
    role: "user",
    content: message,
    createdAt: now,
    status: "completed",
  });
  appendMessage(conversationId, {
    id: assistantMessageId,
    role: "assistant",
    content: "",
    createdAt: now,
    status: "streaming",
    memoryIds: context.longTermMemories.map((item) => item.id),
  });

  const traceId = createTraceId();
  const log = logger(traceId, "chat");
  log.info("request", {
    conversationId,
    msgLen: message.length,
    historyLen: context.history.length,
    memoryCount: context.longTermMemories.length,
    hasSummary: !!context.summary,
    model: model || getCurrentModel(),
  });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("X-Trace-Id", traceId);
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({
    type: "message_started",
    data: { conversationId, userMessageId, assistantMessageId, memoryIds: context.longTermMemories.map((item) => item.id) },
  })}\n\n`);

  let output = "";
  let assistantPatch: Record<string, unknown> = {};
  try {
    const stream = await runAgentStream(message, context.history, traceId, model, skillId, workspace, {
      conversationId,
      userMessageId,
      assistantMessageId,
      contextSections: formatContextSections(context),
    });

    for await (const event of stream) {
      if (event.type === "delta") output += String(event.data || "");
      if (event.type === "skill_matched" && event.data && typeof event.data === "object") {
        const data = event.data as any;
        assistantPatch = {
          ...assistantPatch,
          skillName: data.skillName,
          skillId: data.skillId,
          skillVersion: data.skillVersion,
          skillRunId: data.runId,
        };
      }
      if (event.type === "stats") assistantPatch.stats = event.data;
      res.write(`data: ${JSON.stringify({ ...event, conversationId, messageId: assistantMessageId })}\n\n`);
    }
    patchMessage(conversationId, assistantMessageId, {
      ...assistantPatch,
      content: output,
      status: "completed",
    });
    scheduleConversationSummary(conversationId);
    scheduleProfileExtraction(conversationId);
    log.info("done", { outputLength: output.length });
  } catch (error: any) {
    const friendlyMessage = formatLlmError(error);
    patchMessage(conversationId, assistantMessageId, {
      ...assistantPatch,
      content: output,
      status: "error",
    });
    log.error("error", { message: error.message, friendlyMessage });
    res.write(`data: ${JSON.stringify({ type: "error", data: friendlyMessage, conversationId, messageId: assistantMessageId })}\n\n`);
  }

  res.end();
});

export default router;
