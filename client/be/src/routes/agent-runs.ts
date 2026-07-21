import { Router, Request, Response } from "express";
import { resumeAgentRun } from "../agent";
import {
  AgentRunConflictError,
  AgentRunConversationMismatchError,
  AgentRunExpiredError,
  AgentRunNotFoundError,
  claimAgentRun,
  listPendingAgentRuns,
  saveAgentRunCheckpoint,
} from "../agent-runs/repository";
import { AgentRunCheckpoint } from "../agent-runs/types";
import { formatLlmError } from "../llm-errors";

const router = Router();

function publicApproval(checkpoint: AgentRunCheckpoint) {
  return {
    runId: checkpoint.id,
    conversationId: checkpoint.conversationId,
    assistantMessageId: checkpoint.assistantMessageId,
    kind: checkpoint.pendingApproval.kind,
    toolName: checkpoint.pendingApproval.toolName,
    reason: checkpoint.pendingApproval.reason,
    target: checkpoint.pendingApproval.target,
    expiresAt: checkpoint.expiresAt,
  };
}

function claimErrorStatus(error: unknown): number {
  if (error instanceof AgentRunNotFoundError) return 404;
  if (error instanceof AgentRunConversationMismatchError) return 403;
  if (error instanceof AgentRunConflictError) return 409;
  if (error instanceof AgentRunExpiredError) return 410;
  return 500;
}

router.get("/pending", (req: Request, res: Response) => {
  const conversationId = typeof req.query.conversationId === "string" ? req.query.conversationId : "";
  if (!conversationId) return res.status(400).json({ error: "conversationId is required" });
  res.json({ runs: listPendingAgentRuns(conversationId).map(publicApproval) });
});

async function continueRun(req: Request, res: Response, approved: boolean): Promise<void> {
  const conversationId = typeof req.body?.conversationId === "string" ? req.body.conversationId : undefined;
  let checkpoint: AgentRunCheckpoint;
  try {
    checkpoint = claimAgentRun(req.params.runId, conversationId);
  } catch (error) {
    res.status(claimErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("X-Trace-Id", checkpoint.traceId);
  res.flushHeaders();

  let pausedAgain = false;
  try {
    for await (const event of resumeAgentRun(checkpoint, approved)) {
      if (event.type === "approval_required") pausedAgain = true;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    if (!pausedAgain) {
      saveAgentRunCheckpoint({ ...checkpoint, status: "completed" });
    }
  } catch (error) {
    saveAgentRunCheckpoint({ ...checkpoint, status: "failed" });
    res.write(`data: ${JSON.stringify({ type: "error", data: formatLlmError(error) })}\n\n`);
  }
  res.end();
}

router.post("/:runId/approve", (req, res) => void continueRun(req, res, true));
router.post("/:runId/reject", (req, res) => void continueRun(req, res, false));

export default router;
