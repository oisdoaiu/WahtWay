import { Router, Request, Response } from "express";
import { consumeExternalApproval, executeExternalTool } from "../external-tools/executor";
import {
  deleteExternalTool,
  deleteToolSecret,
  getExternalTool,
  listExternalTools,
  saveExternalTool,
  setToolSecret,
  toPublicTool,
} from "../external-tools/repository";
import { refreshExternalTools } from "../external-tools/registry";

const router = Router();

function errorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  const messages: Record<string, string> = {
    URL_REQUIRED: "请提供外部 API URL",
    HTTPS_REQUIRED: "外部工具只允许 HTTPS URL",
    URL_CREDENTIALS_FORBIDDEN: "URL 中不能包含用户名或密码",
    DYNAMIC_HOST_FORBIDDEN: "外部工具的域名必须固定，不能使用参数或 Secret 模板",
    INVALID_TOOL_ID: "工具 ID 必须是 2-63 位小写字母、数字或连字符",
    NAME_DESCRIPTION_REQUIRED: "请填写名称和描述",
    INVALID_TOOL_OPTION: "请求方法或权限等级无效",
    INVALID_PARAMETERS: "参数 Schema 必须是 object",
    INVALID_SECRET_NAME: "Secret 名称必须使用大写字母、数字和下划线",
    EMPTY_SECRET: "Secret 内容不能为空",
  };
  return messages[code] || code;
}

router.get("/", (_req: Request, res: Response) => {
  res.json({ tools: listExternalTools().map(toPublicTool) });
});

router.get("/:id", (req: Request, res: Response) => {
  const tool = getExternalTool(req.params.id);
  if (!tool) return res.status(404).json({ error: "外部工具不存在" });
  res.json(toPublicTool(tool));
});

router.post("/", (req: Request, res: Response) => {
  try {
    if (getExternalTool(String(req.body?.id || ""))) return res.status(409).json({ error: "工具 ID 已存在" });
    const tool = saveExternalTool(req.body);
    refreshExternalTools();
    res.status(201).json(toPublicTool(tool));
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.patch("/:id", (req: Request, res: Response) => {
  try {
    const current = getExternalTool(req.params.id);
    if (!current) return res.status(404).json({ error: "外部工具不存在" });
    const tool = saveExternalTool({ ...req.body, id: current.id });
    refreshExternalTools();
    res.json(toPublicTool(tool));
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.delete("/:id", (req: Request, res: Response) => {
  if (!deleteExternalTool(req.params.id)) return res.status(404).json({ error: "外部工具不存在" });
  refreshExternalTools();
  res.json({ success: true });
});

router.put("/:id/secrets/:name", (req: Request, res: Response) => {
  try {
    if (typeof req.body?.value !== "string") return res.status(400).json({ error: "请提供 secret value" });
    setToolSecret(req.params.id, req.params.name, req.body.value);
    const tool = getExternalTool(req.params.id)!;
    res.json(toPublicTool(tool));
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.delete("/:id/secrets/:name", (req: Request, res: Response) => {
  if (!deleteToolSecret(req.params.id, req.params.name)) return res.status(404).json({ error: "Secret 不存在" });
  res.json({ success: true });
});

router.post("/:id/test", async (req: Request, res: Response) => {
  const tool = getExternalTool(req.params.id);
  if (!tool) return res.status(404).json({ error: "外部工具不存在" });
  try {
    const output = await executeExternalTool(tool, req.body?.args || {}, true);
    res.json({ success: true, output });
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/approve/execute", async (req: Request, res: Response) => {
  try {
    const approval = consumeExternalApproval(String(req.body?.token || ""));
    const tool = getExternalTool(approval.toolId);
    if (!tool) return res.status(404).json({ error: "外部工具不存在" });
    const output = await executeExternalTool(tool, approval.args, true);
    res.json({ success: true, output });
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

export default router;
