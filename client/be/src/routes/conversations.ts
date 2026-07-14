// 对话历史 CRUD
// 存储: be/data/conversations/{id}.json

import { Router, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";

const router = Router();
const DATA_DIR = path.resolve(__dirname, "../../data/conversations");

function listFiles(): string[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
}

// GET 对话列表（元信息，不含完整消息）
router.get("/", (_req: Request, res: Response) => {
  const list = listFiles().map((f) => {
    try {
      const data = JSON.parse(
        fs.readFileSync(path.join(DATA_DIR, f), "utf-8")
      );
      return { id: data.id, title: data.title, updatedAt: data.updatedAt };
    } catch {
      return null;
    }
  }).filter(Boolean);
  res.json({ conversations: list.sort((a: any, b: any) => b.updatedAt - a.updatedAt) });
});

// GET 单个对话完整消息
router.get("/:id", (req: Request, res: Response) => {
  const filePath = path.join(DATA_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "对话不存在" });
  }
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  res.json(data);
});

// POST 新建对话
router.post("/", (req: Request, res: Response) => {
  const id = Date.now().toString();
  const now = Date.now();
  const conv = {
    id,
    title: "新对话",
    messages: [] as any[],
    createdAt: now,
    updatedAt: now,
  };
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, `${id}.json`), JSON.stringify(conv, null, 2));
  res.json(conv);
});

// DELETE 删除对话
router.delete("/:id", (req: Request, res: Response) => {
  const filePath = path.join(DATA_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "对话不存在" });
  }
  fs.unlinkSync(filePath);
  res.json({ success: true });
});

// PUT 保存对话（聊天过程中自动保存）
router.put("/:id", (req: Request, res: Response) => {
  const { title, messages } = req.body;
  const filePath = path.join(DATA_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "对话不存在" });
  }
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  if (title) data.title = title;
  if (messages) data.messages = messages;
  data.updatedAt = Date.now();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  res.json({ success: true });
});

export default router;
