// Tool 注册表

import { ToolDef } from "../types";

const tools: Map<string, ToolDef> = new Map();

export function registerTool(tool: ToolDef): void {
  tools.set(tool.name, tool);
  console.log(`🔧 Tool 已注册: ${tool.name}`);
}

export function getTool(name: string): ToolDef | null {
  return tools.get(name) || null;
}

export function getAllTools(): ToolDef[] {
  return Array.from(tools.values());
}

/** 格式化为 OpenAI Function Calling 格式 */
export function formatToolsForLLM(): Record<string, unknown>[] {
  return getAllTools().map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
