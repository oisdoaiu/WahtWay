import { ToolDef } from "../types";
import { registerTool, unregisterTool } from "../tools/registry";
import { executeExternalTool } from "./executor";
import { getExternalTool, listExternalTools } from "./repository";

const registeredIds = new Set<string>();

function toolName(id: string): string {
  return `external-${id}`;
}

export function refreshExternalTools(): void {
  for (const id of registeredIds) unregisterTool(toolName(id));
  registeredIds.clear();
  for (const config of listExternalTools().filter((tool) => tool.enabled)) {
    const definition: ToolDef = {
      name: toolName(config.id),
      description: `${config.description}\n外部 HTTPS 工具，权限级别: ${config.permission === "read" ? "只读" : "写操作，调用前需要用户确认"}。`,
      parameters: config.parameters,
      execute: async (args) => {
        const current = getExternalTool(config.id);
        if (!current) return "错误: 外部工具不存在";
        try { return await executeExternalTool(current, args); }
        catch (error) { return `错误: ${error instanceof Error ? error.message : String(error)}`; }
      },
    };
    registerTool(definition);
    registeredIds.add(config.id);
  }
}
