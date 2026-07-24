import { Router, Request, Response } from "express";
import {
  acceptSuggestion,
  createMemoryItem,
  deleteMemoryItem,
  listMemoryItems,
  updateMemoryItem,
} from "../memory/repository";

const router = Router();

function handleMemoryError(error: unknown, res: Response): void {
  const code = error instanceof Error ? error.message : "MEMORY_ERROR";
  if (code === "SENSITIVE_MEMORY_BLOCKED") {
    res.status(400).json({ error: "检测到密码、密钥、token 或类似敏感信息，未保�?" });
    return;
  }
  res.status(400).json({ error: code === "EMPTY_MEMORY" ? "记忆内容不能为空" : "记忆操作失败" });
}

router.get("/", (_req: Request, res: Response) => {
  res.json({ memories: listMemoryItems() });
});

router.post("/", (req: Request, res: Response) => {
  try {
    if (typeof req.body?.content !== "string") return res.status(400).json({ error: "请提供记忆内�?" });
    res.status(201).json(createMemoryItem(req.body));
  } catch (error) {
    handleMemoryError(error, res);
  }
});

router.patch("/:id", (req: Request, res: Response) => {
  try {
    const item = updateMemoryItem(req.params.id, req.body || {});
    if (!item) return res.status(404).json({ error: "记忆不存�?" });
    res.json(item);
  } catch (error) {
    handleMemoryError(error, res);
  }
});

router.delete("/:id", (req: Request, res: Response) => {
  if (!deleteMemoryItem(req.params.id)) return res.status(404).json({ error: "记忆不存�?" });
  res.json({ success: true });
});

// Phase 4：将自动提取�? suggested 候选转正为正式记忆
router.post("/suggestions/:id/accept", (req: Request, res: Response) => {
  try {
    const item = acceptSuggestion(req.params.id);
    if (!item) return res.status(404).json({ error: "记忆不存�?" });
    res.json(item);
  } catch (error) {
    handleMemoryError(error, res);
  }
});

export default router;
