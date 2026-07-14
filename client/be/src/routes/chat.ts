// POST /api/chat — SSE 流式对话

import { Router, Request, Response } from "express";
import { runAgentStream } from "../agent";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  const { message } = req.body;

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "请提供 message 字段" });
    return;
  }

  // 设置 SSE 响应头
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // 禁用 nginx 缓冲
  res.flushHeaders();

  try {
    const stream = await runAgentStream(message);

    for await (const event of stream) {
      // 每段数据以 "data: <json>\n\n" 格式推送
      // 字段名与 Agent StreamEvent type 保持一致：
      //   skill_matched → agent 匹配了哪个 Skill
      //   delta         → 逐字 token 内容
      //   done          → 结束，含 fullContent 和 tokenUsage
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  } catch (err: any) {
    res.write(
      `data: ${JSON.stringify({ type: "error", data: err.message })}\n\n`
    );
  }

  res.end();
});

export default router;
