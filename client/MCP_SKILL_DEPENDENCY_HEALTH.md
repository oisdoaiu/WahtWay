# MCP-Skill 依赖健康与运行前检查设计

## 目标

MCP Skill 助手依赖特定 MCP Server 和工具。系统需要在 Skill 列表、模式选择和 Agent 执行入口使用同一套实时判定，避免工具已经停止、删除或改名后仍启动 Skill。

健康状态是运行时派生数据，不写回 Skill JSON：

- `healthy`：所有硬依赖可用。
- `degraded`：硬依赖可用，但可选工具缺失。
- `unavailable`：至少一个硬依赖不可用，禁止启动 Skill。

## 依赖来源

每个 Skill 的依赖由三个字段共同描述：

- `requiredTools`：硬依赖。每项必须存在于 Agent Tool Registry。
- `mcpBindings`：硬依赖。每项必须能解析到一个已启用、正在运行且未禁用的 MCP 工具。
- `allowedTools`：Agent 可见工具白名单。仅在这里声明的非硬依赖工具缺失时，Skill 降级但仍可运行。

MCP binding 按 `serverId + toolName` 定位工具，`registeredName` 用于识别注册名漂移，并确认 Registry 中存在 Agent 实际可调用的工具。

## 判定规则

对每个 MCP binding 依次检查：

1. Server 配置存在。
2. Server 已启用。
3. Server runtime state 为 `running`。
4. 当前工具清单中存在原始 `toolName`。
5. 工具权限不是 `disabled`；`confirm` 属于可用状态，审批仍由 MCP runtime 处理。
6. 当前 `registeredName` 与 binding 保存值一致。
7. Tool Registry 中实际存在该 `registeredName`。

任一检查失败都会产生结构化 issue，并使 Skill 变为 `unavailable`。当注册名发生变化时，issue 同时返回 `suggestedRegisteredName`，用于展示重绑定提示；首版不会自动修改 Skill。

对普通工具：

- `requiredTools` 缺失或未包含在非空 `allowedTools` 白名单中时阻断。
- 仅 `allowedTools` 中的可选工具缺失时标记为 `degraded`。

## API

`GET /api/skills` 为每个本地 Skill 增加只读字段：

```json
{
  "dependencyHealth": {
    "status": "healthy",
    "runnable": true,
    "checkedAt": "2026-07-25T00:00:00.000Z",
    "issues": [],
    "bindings": []
  }
}
```

`GET /api/skills/:id/dependencies` 返回单个 Skill 的最新健康状态，供局部刷新和诊断使用。该接口不执行 ping、不启动 Server，也不修改任何配置。

## Agent 阻断

显式选择或自动匹配出 Skill 后，Agent 在创建观察记录、发送 `skill_matched` 事件和请求 LLM 前执行同一健康检查。不可运行时抛出带结构化 health 的 `SkillDependencyError`，聊天 SSE 返回可操作的中文错误。

CLI 的非流式入口使用相同检查。前端禁用不可用模式只是交互优化，服务端检查始终是最终规则，覆盖检查后 Server 并发停止等竞态。

## 前端行为

- Skill 卡片显示健康、降级或不可用状态，并展示首个问题和修复提示。
- 模式选择器保留不可用 Skill 的可见性，但禁止选中并解释原因。
- 当前已选模式后来失效时，在输入区提示并阻止发送。
- MCP 页面按 `serverId + toolName` 展示所有关联 Skill；Server 停止、工具列表为空时仍展示受影响关系。
- 删除 Server 后产生的孤立 binding 在 MCP 页面单独展示，避免失效关系无处可查。

## 边界与后续

- 健康检查不自动重启 Server、不自动启用工具、不自动重绑定。
- 多 binding Skill 采用保守策略：任一硬依赖异常即阻断。
- 当前 binding 没有工具 Schema 基线，因此本阶段不声称检测 Schema 漂移。后续可增加稳定 Schema hash，并同步 Skill Hub 校验与 manifest schema。
- 检查只能反映某一时刻的快照；实际调用仍必须保留 MCP runtime 自身的权限和连接校验。
