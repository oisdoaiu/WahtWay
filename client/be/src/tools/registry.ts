// Tool 注册表

import { ToolDef } from "../types";

const tools: Map<string, ToolDef> = new Map();

export function registerTool(tool: ToolDef): void {
  tools.set(tool.name, tool);
  console.log(`🔧 Tool 已注册: ${tool.name}`);
}

export function unregisterTool(name: string): void {
  tools.delete(name);
}

export function getTool(name: string): ToolDef | null {
  return tools.get(name) || null;
}

export function getAllTools(): ToolDef[] {
  return Array.from(tools.values());
}

/** 格式化为 OpenAI Function Calling 格式（支持白名单 + 示例） */
export function formatToolsForLLM(allowedTools?: string[]): Record<string, unknown>[] {
  let list = getAllTools();
  // 白名单过滤
  if (allowedTools && allowedTools.length > 0) {
    const set = new Set(allowedTools);
    list = list.filter(t => set.has(t.name));
  }
  return list.map((t) => {
    let desc = t.description;
    // 附加 input_examples
    if (t.input_examples && t.input_examples.length > 0) {
      desc += "\n\n调用示例:\n" + t.input_examples
        .map(ex => `- ${ex.description}: ${JSON.stringify(ex.args)}`)
        .join("\n");
    }
    return {
      type: "function",
      function: { name: t.name, description: desc, parameters: t.parameters },
    };
  });
}
