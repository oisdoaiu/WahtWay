# MCP-Skill 依赖修复与重新绑定设计

## 目标

在现有依赖健康检查和 Agent 运行前阻断之上，增加用户可控的修复闭环：

1. 明确展示失败原因。
2. 对可恢复状态提供显式操作。
3. 对失效 binding 提供候选工具。
4. 在写入前展示完整字段 diff 和风险提示。
5. 原子更新 Skill manifest，并重新检查健康状态。

修复是本地能力，不修改 Skill Hub 协议，也不会安装、启动或执行用户未确认的外部程序。

## 恢复动作

运行态问题复用现有 MCP API：

- `mcp_server_not_running`：用户点击后启动 Server。
- `mcp_server_disabled`：用户点击后先启用，再启动；启动失败时保留已启用状态并展示错误。
- `mcp_tool_disabled`：用户确认后将该工具权限改为 `confirm`，不自动设置为 `auto`。
- `mcp_tool_not_allowed`：将当前 binding 注册名显式补入非空 Skill 工具白名单。
- `mcp_tool_unregistered`：用户点击后重启 Server。
- `mcp_registered_name_changed`：进入 binding diff 确认。
- `mcp_tool_missing` / `mcp_server_missing`：由用户从候选列表选择替代工具。

读取页面、健康检查和候选查询均无副作用。

## 候选与并发控制

候选只来自当前 MCP runtime 快照，且必须满足：

- Server 已启用且为 `running`。
- Tool permission 不是 `disabled`。
- `registeredName` 已存在于 Agent Tool Registry。

候选按以下顺序排序：同 Server 同 toolName、跨 Server 同 toolName、同 Server 其他工具、其他工具。只有同 Server 同 toolName 的注册名漂移候选标记为推荐，系统不会自动选择其他工具。

候选响应返回：

- `expectedRevision`：基础 Skill manifest 的稳定 SHA-256。
- `expectedBinding`：客户端当前看到的完整 binding。
- `toolListRevision`：目标 Server 当前工具列表 revision。

预览和提交都重新读取 Skill；提交还会重新解析 MCP runtime 和 Registry。revision、原 binding 或工具列表发生变化时返回 `409`，客户端必须重新预览。

## API

### 查询候选

`GET /api/skills/:id/mcp-bindings/:index/candidates`

返回当前 binding、健康问题、候选工具、并发 revision 和最近修复记录。响应只包含最小工具元数据，不返回 Server command、env、cwd 或 secret。

### 预览变更

`POST /api/skills/:id/mcp-bindings/:index/preview`

```json
{
  "expectedRevision": "sha256",
  "expectedBinding": {
    "serverId": "old-server",
    "toolName": "old-tool",
    "registeredName": "mcp-old-server-old-tool"
  },
  "replacement": {
    "serverId": "new-server",
    "toolName": "new-tool"
  },
  "expectedToolListRevision": 7,
  "promptPolicy": "replace-exact"
}
```

`promptPolicy` 可为：

- `preserve`：不修改自定义 Prompt。
- `replace-exact`：只替换独立、完整的旧 `registeredName` token，并在响应中返回替换次数和 diff。

### 确认写入

`PATCH /api/skills/:id/mcp-bindings/:index`

请求体与预览相同。成功返回新 revision、最新 dependency health 和 audit event。

### 修复记录

`GET /api/skills/:id/dependency-repairs?limit=50`

## 原子字段更新

一次 binding 更新在内存中生成完整新 manifest，然后通过同目录临时文件和 rename 原子替换 Skill JSON。更新规则：

- 替换指定 `mcpBindings[index]`。
- `allowedTools` 非空时，将旧注册名替换为新注册名并保序去重；空数组保持原语义。
- `requiredTools` 中存在旧注册名时同步替换并保序去重。
- 旧注册名仍被其他 binding 使用时不误删。
- 拒绝重复的 `(serverId, toolName)` binding。
- Prompt 仅按用户已预览并确认的 policy 处理。

当前存在 active learned version 时返回 `409`，提示用户先恢复基础版本。本阶段不静默修改或压平学习版本。

## 审计

修复事件独立存储在本地 Skill learning 数据目录，最多滚动保留 500 条，采用权限受限的原子 JSON 写入。事件只保存：

- Skill ID、binding index、时间。
- 修改前后 binding 和 revision。
- 变更字段、Prompt policy、替换次数、warnings。

不保存完整 Prompt、Server 配置、参数、环境变量或 secret。Skill 写入成功但审计失败时，接口返回成功并标记 `auditRecorded: false`，避免用户重试造成二次修改。

## 前端流程

- Skill 卡片的异常入口携带 Skill ID 跳转 MCP 页面并定位 binding。
- MCP binding 行按 issue 显示对应恢复操作。
- 重绑定使用扁平候选列表，不自动选择跨 Server 或不同工具。
- 确认页只渲染服务端返回的 diff、权限/风险和 warnings。
- `409` 时废弃旧预览并重新加载，不尝试覆盖。
- 保存成功后重新获取依赖健康；目标问题消失后才关闭修复流程。
