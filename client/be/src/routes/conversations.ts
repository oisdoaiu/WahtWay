import { Router, Request, Response } from "express";
import OpenAI from "openai";
import { resolveModel } from "../models";
import {
  createConversation,
  deleteConversation,
  listConversations,
  readConversation,
  updateConversation,
} from "../conversations/repository";

const router = Router();

function getAIClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  });
}

router.get("/", (_req: Request, res: Response) => {
  res.json({ conversations: listConversations() });
});

router.get("/:id", (req: Request, res: Response) => {
  const conversation = readConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: "对话不存在" });
  res.json(conversation);
});

router.post("/", (req: Request, res: Response) => {
  res.status(201).json(createConversation(req.body || {}));
});

router.patch("/:id", (req: Request, res: Response) => {
  const conversation = updateConversation(req.params.id, {
    title: req.body?.title,
    memoryMode: req.body?.memoryMode,
  });
  if (!conversation) return res.status(404).json({ error: "对话不存在" });
  res.json(conversation);
});

// Compatibility for existing clients. Messages are intentionally ignored.
router.put("/:id", (req: Request, res: Response) => {
  const conversation = updateConversation(req.params.id, { title: req.body?.title });
  if (!conversation) return res.status(404).json({ error: "对话不存在" });
  res.json(conversation);
});

router.delete("/:id", (req: Request, res: Response) => {
  if (!deleteConversation(req.params.id)) return res.status(404).json({ error: "对话不存在" });
  res.json({ success: true });
});

router.post("/:id/summarize", async (req: Request, res: Response) => {
  const conversation = readConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: "对话不存在" });
  try {
    const firstMessage = conversation.messages.find((message) => message.role === "user")?.content.slice(0, 200);
    if (!firstMessage) return res.json({ title: conversation.title });
    const response = await getAIClient().chat.completions.create({
      model: resolveModel(process.env.DEEPSEEK_MODEL),
      messages: [{ role: "user", content: `用不超过15个字给这段对话起标题，直接输出标题：${firstMessage}` }],
      max_tokens: 30,
      temperature: 0.3,
    });
    const title = response.choices[0]?.message?.content?.trim().slice(0, 30) || conversation.title;
    updateConversation(conversation.id, { title });
    res.json({ title });
  } catch {
    res.json({ title: conversation.title });
  }
});

export default router;
