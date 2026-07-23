# MCP 工具变化审计设计

## 目标

记录 MCP Server 在运行中通过 `notifications/tools/list_changed` 产生的工具新增、删除和元数据变化，支持管理页查询历史并定位动态能力变化。审计只覆盖工具定义，不记录工具调用参数、执行结果、环境变量或 Secret。

## 审计事件

```ts
interface McpToolChangeAuditEvent {
  id: string;
  serverId: string;
  revision: number;
  source: "list_changed";
  createdAt: string;
  added: McpAuditedTool[];
  removed: McpAuditedTool[];
  modified: Array<{
    name: string;
    changedFields: Array<"description" | "inputSchema" | "permission" | "registeredName">;
    before: McpAuditedTool;
    after: McpAuditedTool;
  }>;
}
```

`McpAuditedTool` 保存 tool name、Agent 注册名、description、inputSchema 和有效权限。记录完整前后值是为了在 UI 中解释 schema 或权限到底如何变化，不依赖当前运行状态反推历史。

## 差异计算

工具以原始 MCP tool name 为主键：

- 旧列表不存在、新列表存在：added。
- 旧列表存在、新列表不存在：removed。
- 两边都存在但字段不同：modified。
- 列表顺序变化但字段一致：不产生事件。

对象 Schema 使用键排序后的稳定 JSON 比较，避免仅属性插入顺序不同造成误报。若一次通知没有实际差异，Registry revision 不增长，也不写空审计事件。

## 一致性

通知刷新按 Server ID 串行执行：

```text
获取完整新列表
  -> 校验名称和权限
  -> 计算差异
  -> 原子持久化审计事件
  -> 同步替换 Tool Registry
  -> 更新运行状态 revision
```

如果审计持久化失败，不切换 Registry，并通过 `lastToolListError` 暴露错误。这样不会出现工具能力已经变化但缺少对应审计记录的状态。

## 存储与保留

```text
<WAHTWAY_DATA_DIR>/mcp-servers/tool-change-audit.json
```

采用临时文件加 rename 原子写入，权限模式为当前用户可读写。全局最多保留最近 500 条事件，单次 API 最多返回 100 条。达到上限后删除最旧事件。

## API

```text
GET /api/mcp/servers/:id/tool-audit?limit=50
```

只允许查询仍存在的 Server。返回按时间倒序排列的事件。首期不提供修改接口；审计记录由 runtime 生成，前端不能伪造。

## UI

每个 MCP Server 增加“变更记录”入口。面板展示：

- 时间和 revision。
- 新增、删除、修改数量。
- 受影响的工具名称。
- 修改字段及权限前后值。

工具 schema 只展示“参数结构已变化”，完整值保留在 API 中供后续详情视图使用，避免列表过密。
