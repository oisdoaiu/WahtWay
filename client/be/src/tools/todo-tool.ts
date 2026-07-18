// Todo/Planning Tool — Agent 自动拆解任务 + 逐步执行

import { ToolDef } from "../types";

/** 当前会话的 Todo 列表（存在内存中，不持久化） */
let todoItems: { id: number; text: string; done: boolean }[] = [];

export function getTodoItems() { return [...todoItems]; }
export function clearTodo() { todoItems = []; }

export const todoUpdateTool: ToolDef = {
  name: "todo-update",
  description: `维护当前任务列表。在接到复杂任务时，先用此工具列出步骤计划；完成一步后标记为完成。用户可以看到进度。

参数格式: JSON 数组，每项 { "id": 数字, "text": "步骤描述", "done": true/false }
- 新任务: 列出所有步骤（done: false）
- 完成步骤: 标记 done: true
- 添加步骤: 加入新项`,
  input_examples: [
    {
      description: "制定计划",
      args: {
        items: [
          { id: 1, text: "搜索相关文件", done: false },
          { id: 2, text: "阅读并分析内容", done: false },
          { id: 3, text: "输出总结报告", done: false },
        ]
      }
    },
    { description: "完成第一步", args: { items: [{ id: 1, text: "搜索相关文件", done: true }] } },
  ],
  parameters: {
    type: "object",
    properties: {
      items: { type: "array", description: "Todo 项数组" },
    },
    required: ["items"],
  },
  execute: async (args) => {
    const items = args.items as any[];
    if (!Array.isArray(items)) return "请提供 items 数组";
    for (const item of items) {
      const existing = todoItems.find(t => t.id === item.id);
      if (existing) {
        if (item.done) existing.done = true;
        if (item.text) existing.text = item.text;
      } else {
        todoItems.push({ id: item.id || Date.now(), text: item.text || "", done: !!item.done });
      }
    }
    const done = todoItems.filter(t => t.done).length;
    const total = todoItems.length;
    const lines = todoItems.map(t => `${t.done ? "✅" : "⬜"} ${t.text}`);
    return `任务进度 (${done}/${total}):\n${lines.join("\n")}`;
  },
};
