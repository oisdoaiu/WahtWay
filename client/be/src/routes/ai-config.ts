import { Router, Request, Response } from "express";
import {
  getAiSettings,
  getDefaultAiSettings,
  getPublicAiSettings,
  isAiConfigured,
  saveAiSettings,
} from "../ai-settings";
import { fetchAvailableModels } from "../ai-models";

const router = Router();

router.get("/", (_req: Request, res: Response) => {
  res.json({
    settings: getPublicAiSettings(),
    configured: isAiConfigured(),
    defaults: {
      deepseek: getDefaultAiSettings("deepseek"),
      "openai-compatible": getDefaultAiSettings("openai-compatible"),
    },
  });
});

router.post("/models", async (req: Request, res: Response) => {
  const current = getAiSettings();
  const baseURL = typeof req.body?.baseURL === "string" && req.body.baseURL.trim()
    ? req.body.baseURL.trim()
    : current.baseURL;
  const apiKey = typeof req.body?.apiKey === "string" && req.body.apiKey.trim()
    ? req.body.apiKey.trim()
    : current.apiKey;
  if (!apiKey) {
    res.status(400).json({ error: "请先输入 API Key" });
    return;
  }

  try {
    const models = await fetchAvailableModels(baseURL, apiKey);
    if (models.length === 0) {
      res.status(502).json({ error: "服务商没有返回可用模型" });
      return;
    }
    res.json({ models });
  } catch (error: any) {
    res.status(502).json({ error: `获取模型失败: ${error.message}` });
  }
});

router.post("/", (req: Request, res: Response) => {
  try {
    const current = getAiSettings();
    const body = req.body || {};
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : undefined;
    if (!current.apiKey && !apiKey) {
      res.status(400).json({ error: "请先输入 API Key" });
      return;
    }
    const next = saveAiSettings({
      provider: body.provider,
      apiKey: apiKey === "" ? (current.apiKey || "") : apiKey,
      baseURL: typeof body.baseURL === "string" ? body.baseURL : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
      modelOptions: Array.isArray(body.modelOptions) ? body.modelOptions : undefined,
      balancePath: typeof body.balancePath === "string" ? body.balancePath : undefined,
    });
    res.json({ success: true, settings: getPublicAiSettings(), configured: !!next.apiKey });
  } catch (error: any) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
