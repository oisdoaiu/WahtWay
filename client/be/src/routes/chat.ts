// POST /api/chat — SSE 流式对话

import { Router, Request, Response } from "express";
import { runAgentStream, setModel, getCurrentModel } from "../agent";
import { createTraceId, logger } from "../logger";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  const { message, history, model, skillId, workspace } = req.body;

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "请提供 message 字段" });
    return;
  }

  const traceId = createTraceId();
  const log = logger(traceId, "chat");
  log.info("request", { msgLen: message.length, historyLen: history?.length || 0, model: model || getCurrentModel() });

  // 设置 SSE 响应头
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("X-Trace-Id", traceId);
  res.flushHeaders();

  try {
    const stream = await runAgentStream(message, history, traceId, model, skillId, workspace);

    for await (const event of stream) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    log.info("done");
  } catch (err: any) {
    log.error("error", { message: err.message });
    res.write(
      `data: ${JSON.stringify({ type: "error", data: err.message })}\n\n`
    );
  }

  res.end();
});

export default router;
