# MCP 与 Skill 关联设计

MCP Tool 是执行能力，Skill 是理解用户目标并组织工具调用的专用助手。二者通过可选 `mcpBindings` 建立可追踪关联，同时继续使用 `allowedTools` 作为 Agent 的实际工具白名单。

```ts
interface McpSkillBinding {
  serverId: string;
  toolName: string;
  registeredName: string;
}
```

MCP 管理页可以为运行中的非 disabled 工具创建专用 Skill。后端根据工具 description、inputSchema、registeredName 和风险生成确定性 Skill，写入单工具白名单和 binding。创建过程不调用 LLM，结果可预测且不会把工具返回内容写入 prompt。

Skill 列表公开 binding，MCP 页面据此显示已关联状态。Server 停止或工具临时消失时 binding 不会被删除；再次启动后仍可恢复关联。实际调用继续经过 MCP 有效权限、安全元数据和 Agent 审批恢复流程，Skill 关联不能绕过 runtime。
