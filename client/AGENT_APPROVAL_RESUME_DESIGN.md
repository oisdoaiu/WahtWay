# Agent 工具审批恢复设计

## 1. 背景与目标

当前工具在需要授权时返回 `*_PERMISSION_REQUIRED` 字符串，Agent 会把它当作普通工具结果继续推理；前端批准后再单独执行工具，甚至重新发送用户输入。这样会丢失原始 tool call 与模型上下文，也可能造成重复回复、重复执行和跨对话状态错配。

本功能将审批纳入 Agent 运行状态机：遇到待授权工具时暂停原运行，保存上下文；用户批准或拒绝后，将真实工具结果或拒绝结果写回同一个 tool call，再继续原 Agent 循环。

目标：

- 审批后恢复原始 Agent 运行，不重新发送用户消息。
- 保留 system prompt、历史消息、模型 tool call、已完成工具结果和轮次统计。
- 审批与 `conversationId` 绑定，禁止不同对话领取同一待审批任务。
- 每个待审批项只能消费一次，重复请求返回冲突。
- 批准和拒绝都能继续模型推理，并通过 SSE 返回后续内容。
- 页面刷新后可以查询当前对话尚未处理的审批。

## 2. 状态模型

每次可暂停的 Agent 执行拥有稳定的 `runId`：

```text
running -> waiting_approval -> resuming -> completed
                       |          |
                       |          +-> waiting_approval（后续工具再次需要审批）
                       +-> resuming（用户拒绝，将拒绝结果注入上下文）

running/resuming -> failed
waiting_approval -> expired
```

`waiting_approval -> resuming` 使用原子状态更新。只有第一个批准或拒绝请求可以成功，后续请求返回 `409 Conflict`。

## 3. 持久化模型

运行状态存放在客户端后端运行数据目录的 `agent-runs/` 下，每个运行一个 JSON 文件。该目录属于运行时数据，必须被 Git 忽略。第一阶段使用 JSON，原因是当前客户端后端已经采用本地 JSON 数据模式，且待审批运行数量很少；若以后需要多进程并发或大量运行查询，再迁移 SQLite。

```ts
interface AgentRunCheckpoint {
  id: string;
  status: "waiting_approval" | "resuming" | "completed" | "failed" | "expired";
  conversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  traceId: string;
  model?: string;
  systemPrompt: string;
  messages: ChatCompletionMessageParam[];
  allowedTools?: string[];
  workspace?: string;
  round: number;
  totalRoundTokens: number;
  toolCallCount: number;
  currentBatch: {
    calls: SerializedToolCall[];
    nextIndex: number;
  };
  pendingApproval: {
    toolCallId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    kind: "file" | "command" | "external" | "mcp";
    reason: string;
    target?: string;
  };
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}
```

文件写入采用“临时文件 + rename”，避免进程中断留下半个 JSON。读取时校验结构和过期时间，并限制单文件大小。运行上下文可能包含用户消息和工具参数，因此不写日志、不进入 Git，文件权限应尽量限制为当前用户。

## 4. Agent 暂停与恢复

### 4.1 初次执行

1. 按现有顺序构造模型消息并请求 LLM。
2. 保存 assistant 的文本和完整 `tool_calls` 消息。
3. 顺序执行工具调用。
4. 普通工具结果立即追加对应的 `tool` 消息。
5. 工具返回待授权标记时，不把标记追加为模型可见结果。
6. 保存 checkpoint，包括已经完成的工具结果、当前待审批调用和同一批次中尚未处理的调用。
7. SSE 发送结构化 `approval_required` 事件并结束本次 HTTP 流，但运行状态保持 `waiting_approval`。

### 4.2 批准

1. API 校验 `runId`、状态和可选 `conversationId`。
2. 原子领取 checkpoint，将状态改为 `resuming`。
3. 依据保存的工具名称和参数执行已批准操作。
4. 将真实执行结果作为原 `tool_call_id` 的 `tool` 消息追加到上下文。
5. 继续处理同一批次剩余 tool call；如再次需要审批，生成新的 `waiting_approval` checkpoint。
6. 批次完成后继续请求 LLM，直至完成、失败或再次暂停。

已批准执行以 checkpoint 为授权凭证，不依赖只存在内存中的临时 token，从而允许页面刷新后恢复。MCP 服务仍需处于可连接状态。

### 4.3 拒绝

拒绝不会丢弃整次运行。后端为原 tool call 写入明确、固定的拒绝结果，例如“用户拒绝执行该操作，请勿重复请求同一操作，并说明受影响的任务”。随后继续处理剩余调用和模型推理，让 Agent 给出可理解的说明或安全替代方案。

## 5. API 与 SSE

### 查询待审批运行

```http
GET /api/agent-runs/pending?conversationId=<id>
```

返回当前对话未过期的待审批项。没有 `conversationId` 时不允许列出其他对话的详情。

### 批准并续跑

```http
POST /api/agent-runs/:runId/approve
Content-Type: application/json

{ "conversationId": "..." }
```

响应为 SSE，事件与 `/api/chat` 共用格式。批准成功后先发送真实 `tool_result`，再发送后续 `delta`、`stats`、`done` 或新的 `approval_required`。

### 拒绝并续跑

```http
POST /api/agent-runs/:runId/reject
Content-Type: application/json

{ "conversationId": "..." }
```

同样返回 SSE。重复审批、已完成、已过期或会话不匹配分别返回 `409`、`410` 或 `403`，不得执行工具。

### 新事件

```ts
interface ApprovalRequiredEvent {
  type: "approval_required";
  data: {
    runId: string;
    conversationId?: string;
    kind: "file" | "command" | "external" | "mcp";
    toolName: string;
    reason: string;
    target?: string;
    expiresAt: string;
  };
}
```

前端不再解析权限字符串，也不直接调用各工具的旧批准接口。

## 6. 隔离与安全规则

- checkpoint 只由 `client/be` 创建和解释，前端不能提交替换后的工具名或参数。
- 审批请求中的 `conversationId` 必须与 checkpoint 一致；对话切换不能复用旧弹窗。
- `runId` 使用不可预测随机 ID，审批领取采用进程内互斥和原子文件更新。
- checkpoint 只保存恢复所需内容；权限标记、完整上下文和敏感参数不输出到日志或 SSE。
- 默认 24 小时过期。过期运行不能执行工具，可由定期清理或读取时惰性清理删除。
- 工具执行前仍执行原有路径、命令、MCP 和外部工具校验；checkpoint 只代表用户批准，不绕过工具自身安全边界。
- 旧的工具专用审批 API 暂时保留兼容性，但新 Agent 流程不再调用它们。

## 7. 前端交互

- `approval_required` 到达后停止当前 SSE loading 状态，展示工具类型、工具名、目标和原因。
- “允许”调用统一批准接口，“拒绝”调用拒绝接口；两者都消费返回的 SSE，并继续追加到原 assistant 消息。
- 审批期间禁用两个按钮，避免双击。
- 切换对话时关闭不属于新对话的审批弹窗，并查询新对话的 pending run。
- 页面刷新后若当前对话存在 pending run，恢复审批提示；不会自动批准或执行。
- 原有“批准后重新 `sendMessage`”逻辑删除。

## 8. 分阶段提交

1. `docs:` 定义运行状态机、API、隔离和安全规则。
2. `feat:` 增加 checkpoint 类型、JSON 仓库、过期清理和并发领取。
3. `refactor:` 将 Agent 工具循环拆为可暂停、可恢复的执行引擎。
4. `feat:` 增加 pending、approve、reject API 和 SSE 续跑。
5. `feat:` 前端使用结构化审批事件并恢复原消息流。
6. `test:` 覆盖批准、拒绝、重复消费、会话不匹配和多工具批次恢复。

## 9. 验收标准

- 写工具请求暂停后，批准只执行一次，并在同一 assistant 回复中继续生成答案。
- 拒绝后 Agent 能继续回复，且不会自动重试相同危险操作。
- 同一回复包含多个工具调用时，暂停前后的工具结果顺序和 `tool_call_id` 均正确。
- 切换到另一个对话不能看到或处理原对话的审批。
- 刷新页面后仍能恢复未过期审批。
- 双击批准或并发批准不会重复执行工具。
- 客户端前后端构建通过，核心状态转换测试通过。
