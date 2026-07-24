# Skill 工具可视化选择器设计

## 目标

将 Skill 编辑器中的手写 `allowedTools` 改为可搜索多选器，统一展示内置、外部和 MCP 工具的名称、描述、来源、有效权限与风险。选择器只编辑白名单，不绕过工具运行时审批。

## 工具目录 API

```text
GET /api/skills/tools/catalog
```

返回当前已注册工具。目录项包含 `name`、`description`、`source`、`risk`、`permission` 和 `available`。MCP 风险与权限取 runtime 的有效结果；外部工具按 read/write 配置映射；内置工具采用保守分类。

## 编辑规则

- `allowedTools=[]` 表示沿用现有语义：不限制可见工具。
- 勾选一个或多个工具后，Agent 只获得白名单工具。
- 搜索同时匹配名称和描述。
- 已选但当前目录不存在的工具保留并标记为“不可用”，由用户显式移除。
- 危险、确认执行和不可用工具显示醒目标识。
- AI 新生成的 Skill 进入编辑步骤后同样使用选择器确认工具权限。

## 安全边界

Skill 白名单只决定模型能看到哪些工具，不决定工具是否自动执行。MCP destructive 强制审批、外部写工具审批和文件/命令安全规则继续由后端 runtime 执行。
