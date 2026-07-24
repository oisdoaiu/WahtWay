# MCP 工具安全元数据设计

## 信任原则

MCP `ToolAnnotations` 明确属于提示信息，Server 可能错误或恶意声明。WahtWay 采用单向保守信任：

- `destructiveHint=true` 可以把工具提升为强制审批。
- `readOnlyHint=true` 不会自动免除审批。
- `idempotentHint=true` 不会自动开启调用重试。
- 只有用户保存的本地安全覆盖可以作为放宽策略的依据。
- `disabled` 始终优先于其他规则。

## 数据模型

配置升级为 schema version 3：

```ts
type McpToolRisk = "read" | "write" | "destructive";

interface McpToolSafetyOverride {
  risk?: McpToolRisk;
  idempotent?: boolean;
}

interface McpServerConfig {
  toolSafetyOverrides: Record<string, McpToolSafetyOverride>;
  schemaVersion: 3;
}
```

运行时工具摘要增加 Server annotations、本地覆盖、有效风险、风险来源和有效幂等性。

## 有效策略

```text
configuredPermission = toolPermissions[name] || defaultToolPermission

configuredPermission=disabled                 -> disabled
local risk=destructive                        -> confirm
server destructiveHint=true                  -> confirm
其他                                           -> configuredPermission
```

风险展示：

```text
本地覆盖                  -> 使用本地 risk，source=local
无覆盖且 destructiveHint  -> destructive，source=server
无覆盖且 readOnlyHint     -> read，source=server-hint
其他                      -> write，source=default
```

`effectiveIdempotent` 只有本地覆盖明确为 `true` 时才成立。Server 的 idempotentHint 单独展示，但不用于自动重试。

## 调用重试

本阶段不自动重放已经发出的 `callTool`。即使本地标记为幂等，也只为后续可靠错误分类建立数据基础。连接超时无法证明 Server 没有完成操作；在区分“发送前断开”和“发送后结果丢失”之前，自动重放仍有重复副作用风险。

## API 与 UI

```text
PATCH  /api/mcp/servers/:id/tool-safety/:toolName
DELETE /api/mcp/servers/:id/tool-safety/:toolName
```

PATCH 接受 `{ risk?, idempotent? }`。删除表示恢复使用 Server 提示和保守默认值。管理页同时展示 Server 声明、本地覆盖、有效风险和最终权限。

## 审计

工具变化审计扩展 `annotations`、`risk`、`riskSource` 和 `idempotent`。Server 修改 annotations 或用户修改本地覆盖时，写入修改前后值，来源分别为 `list_changed` 和 `safety_change`。

## 迁移

schema version 1/2 读取时增加空 `toolSafetyOverrides` 并迁移为 version 3，不改变已有 defaultToolPermission 和 toolPermissions。
