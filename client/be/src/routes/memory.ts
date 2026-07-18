import { Router, Request, Response } from "express";
import {
  createMemoryItem,
  deleteMemoryItem,
  listMemoryItems,
  updateMemoryItem,
} from "../memory/repository";

const router = Router();

function handleMemoryError(error: unknown, res: Response): void {
  const code = error instanceof Error ? error.message : "MEMORY_ERROR";
  if (code === "SENSITIVE_MEMORY_BLOCKED") {
    res.status(400).json({ error: "检测到密码、密钥、token 或类似敏感信息，未保存" });
    return;
  }
  res.status(400).json({ error: code === "EMPTY_MEMORY" ? "记忆内容不能为空" : "记忆操作失败" });
}

router.get("/", (_req: Request, res: Response) => {
  res.json({ memories: listMemoryItems() });
});

router.post("/", (req: Request, res: Response) => {
  try {
    if (typeof req.body?.content !== "string") return res.status(400).json({ error: "请提供记忆内容" });
    res.status(201).json(createMemoryItem(req.body));
  } catch (error) {
    handleMemoryError(error, res);
  }
});

router.patch("/:id", (req: Request, res: Response) => {
  try {
    const item = updateMemoryItem(req.params.id, req.body || {});
    if (!item) return res.status(404).json({ error: "记忆不存在" });
    res.json(item);
  } catch (error) {
    handleMemoryError(error, res);
  }
});

router.delete("/:id", (req: Request, res: Response) => {
  if (!deleteMemoryItem(req.params.id)) return res.status(404).json({ error: "记忆不存在" });
  res.json({ success: true });
});

export default router;
