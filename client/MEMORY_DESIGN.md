# WahtWay 客户端长短期记忆与对话隔离设计

## 1. 背景与现状

本文只覆盖桌面客户端 `client/` 与内嵌后端 `client/be/`，不修改独立的 Skill Hub 服务端。

截至 `origin/main`（`a8e591c`），项目已经具备多对话列表和按对话保存消息的基础能力：

- 前端通过 `/api/conversations` 创建、读取、更新和删除对话。
- 每个对话保存为用户数据目录下的独立 JSON 文件。
- `/api/chat` 接收 `conversationId`，但同时直接信任前端传入的完整 `history`。
- Agent 将该 `history` 原样放在 system prompt 与当前用户消息之间。
- 当前没有 rolling summary，也没有结构化、可管理的长期记忆。
- Agent prompt 中的“文件记忆”只是让模型自行读写笔记文件，不具备明确的数据模型、敏感信息规则、可见性和删除控制，不能替代本设计中的长期记忆。

因此目前的多对话主要是 UI 和文件层面的分离，不是后端强制的上下文隔离。前端传错、漏传或伪造 `history` 时，后端无法保证对话不会串场。

## 2. 设计目标与边界

### 2.1 目标

1. 支持多个独立对话，每个对话拥有自己的消息历史和短期摘要。
2. `client/be` 根据 `conversationId` 读取上下文，前端不再决定注入哪些历史。
3. 长期记忆可跨对话复用，但必须用户可见、可编辑、可删除、可禁用。
4. 默认不自动保存密码、token、密钥、身份证件、金融信息、精确住址、健康信息等敏感内容。
5. 保持 SSE 流式回复、Skill 匹配、工具调用和现有对话 UI 的兼容性。

### 2.2 非目标

- 不在本任务中实现账号同步、云端同步或多用户权限系统。
- 不把 Skill Hub 的登录身份用于客户端本地记忆。
- Phase 1 不实现向量数据库、embedding 检索或自动记忆提取。
- 不允许 Agent 通过通用文件工具绕过 Memory API 静默创建长期记忆。

## 3. 核心原则

- **后端权威**：对话历史、摘要和长期记忆均由 `client/be` 读取、筛选和注入。
- **默认隔离**：短期上下文只能来自当前 `conversationId`。
- **长期记忆显式共享**：只有启用且符合当前记忆模式的长期记忆可跨对话注入。
- **用户控制**：长期记忆的创建、修改、删除和启停都有可见 UI。
- **最小注入**：只注入完成当前请求所需的摘要、近期历史和有限长期记忆。
- **数据与 prompt 分离**：记忆内容作为带边界的数据块注入，不能覆盖系统规则或 Skill 指令。

## 4. 数据模型

时间字段统一使用 ISO 8601 字符串；ID 使用 `crypto.randomUUID()`，不再依赖毫秒时间戳。

### 4.1 Conversation

```ts
interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;

  // 短期记忆，只属于本对话。
  summary: string | null;
  summaryThroughMessageId: string | null;
  summaryUpdatedAt: string | null;

  // 控制本对话是否使用跨对话长期记忆。
  memoryMode: "off" | "manual" | "all";

  // 为后续 schema 迁移预留。
  schemaVersion: 1;
}
```

`memoryMode` 语义：

- `off`：不向 Agent 注入任何长期记忆。
- `manual`：只注入用户在当前对话中明确选择的记忆，作为隐私优先模式。
- `all`：注入所有启用且匹配当前请求的全局长期记忆。

首版默认值建议为 `off`。当长期记忆功能正式上线并完成用户引导后，可由用户主动改为 `all`，不做静默升级。

### 4.2 ChatMessage

```ts
interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  status: "streaming" | "completed" | "aborted" | "error";

  skillId?: string;
  skillName?: string;
  skillVersion?: number;
  skillRunId?: string;
  stats?: {
    totalTokens: number;
    totalTime: number;
    rounds: number;
    toolCalls: number;
    model: string;
  };
}
```

`conversationId` 必须由存储层写入并校验。读取消息时始终以当前对话 ID 过滤，不能接受客户端提交的任意历史数组。

### 4.3 MemoryItem

```ts
interface MemoryItem {
  id: string;
  content: string;
  category: "preference" | "profile" | "project" | "instruction" | "other";
  scope: "global";
  source: "manual" | "suggested";
  sourceConversationId: string | null;
  sourceMessageId: string | null;

  enabled: boolean;
  sensitive: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  schemaVersion: 1;
}
```

Phase 3 只允许 `manual` 直接持久化。未来自动提取只能创建 `suggested` 候选，必须经用户确认后才允许 `enabled: true`。

不在 `MemoryItem` 中保存密码、API key、访问 token、私钥、验证码、支付卡号、身份证件号等秘密。即使用户手动提交，也应在 API 层进行高置信规则检测并阻止保存；对于健康、金融、精确位置等敏感个人信息，应明确警告并要求二次确认，同时标记 `sensitive: true`。敏感记忆默认不参与自动注入。

## 5. 本地存储方案

### 5.1 首期选择：JSON 文件

Phase 1 到 Phase 3 首版继续使用 JSON，理由如下：

- 当前项目已经使用用户数据目录和 JSON 对话文件，改造范围小。
- 桌面客户端当前是单用户、单进程、本地优先场景，数据规模有限。
- 便于开发、人工检查、导出和故障恢复，不引入原生 SQLite 模块的 Electron 打包复杂度。
- 本任务应优先修复上下文权威边界，而不是同时更换存储引擎。

建议目录：

```text
<WAHTWAY_DATA_DIR>/
  conversations/
    <conversationId>.json
  memory/
    items.json
```

每个对话文件包含 `Conversation` 元数据和 `messages` 数组。`memory/items.json` 包含 `{ schemaVersion, items }`。

写入必须采用“临时文件 + rename”的原子替换方式，并在后端按资源串行化写操作，避免流结束、标题更新和摘要更新相互覆盖。所有 ID 必须先做格式校验，最终路径必须确认仍位于目标数据目录内。

### 5.2 何时迁移 SQLite

满足以下任一条件时迁移 SQLite：

- 对话或记忆数量导致列表、筛选、更新出现可感知延迟。
- 需要全文搜索、复杂分类筛选、跨设备同步或多进程并发写入。
- 需要可靠事务来同时提交消息、摘要和记忆引用。
- 单个对话 JSON 文件增长到频繁全量重写不再合理。

SQLite 最终更适合长期形态，但现在引入会扩大实现和 Electron 发布风险。存储访问应从一开始封装为 `ConversationRepository` 和 `MemoryRepository`，使未来迁移不影响路由和 Agent。

## 6. API 设计

所有写接口都在后端完成 schema 校验，忽略未知字段，限制字符串长度。错误统一返回 `{ error: { code, message } }`。

### 6.1 `/api/conversations`

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/conversations` | 返回对话元信息列表，不返回完整消息 |
| `POST` | `/api/conversations` | 创建对话，可选传入 `title`、`memoryMode` |
| `GET` | `/api/conversations/:id` | 返回对话元信息和消息 |
| `PATCH` | `/api/conversations/:id` | 更新标题或 `memoryMode` |
| `DELETE` | `/api/conversations/:id` | 删除对话及其短期摘要，不删除全局长期记忆 |

建议逐步用 `PATCH` 替代当前允许前端覆盖整个 `messages` 数组的 `PUT`。消息写入应由 `/api/chat` 管理，避免客户端覆盖后端摘要或注入其他对话的消息。

创建请求：

```json
{
  "title": "新对话",
  "memoryMode": "off"
}
```

### 6.2 `/api/chat`

```http
POST /api/chat
Content-Type: application/json

{
  "conversationId": "uuid",
  "message": "当前用户消息",
  "clientMessageId": "uuid",
  "model": "deepseek-v4-flash",
  "skillId": "optional-skill-id",
  "workspace": "optional-path",
  "selectedMemoryIds": ["uuid"]
}
```

关键变化：

- `conversationId` 必填，必须对应已存在对话。
- 删除 `history` 请求字段；即使过渡期仍收到，也必须忽略。
- 后端先持久化用户消息，再从同一对话读取摘要和近期历史。
- `selectedMemoryIds` 只在 `memoryMode: manual` 下生效，后端仍需验证这些记忆存在且启用。
- SSE 保持现有事件，并可新增 `message_started`、`memory_context` 和 `summary_updated`。`memory_context` 只返回使用的记忆 ID 和数量，不回显敏感内容。
- 流开始时创建 `streaming` assistant 消息；完成、取消或异常时由后端更新状态和已生成内容。
- 使用 `clientMessageId` 做幂等，防止网络重试造成重复用户消息。

后端持久化回复后，前端只消费 SSE 和重新拉取对话，不再通过 `PUT` 回写整个消息列表。

### 6.3 `/api/memory`

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/memory` | 列出记忆，支持 `enabled`、`category`、关键词筛选 |
| `POST` | `/api/memory` | 用户手动创建长期记忆 |
| `PATCH` | `/api/memory/:id` | 编辑内容、分类或启用状态 |
| `DELETE` | `/api/memory/:id` | 永久删除长期记忆 |

创建请求：

```json
{
  "content": "用户偏好使用 TypeScript 示例",
  "category": "preference",
  "sourceConversationId": "optional-uuid",
  "sourceMessageId": "optional-uuid"
}
```

返回值包含 `sensitive` 判定结果。未来可增加 `POST /api/memory/suggestions/:id/accept`，但不应在 Phase 3 首版中让模型直接写入正式记忆。

## 7. Agent prompt 组装流程

上下文由后端 `ContextBuilder` 统一构建，Skill 匹配和最终回答共用同一份受控上下文视图，避免两处规则不一致。

固定顺序如下：

1. `systemPrompt`：基础行为规则、当前 Skill system prompt、工具策略和不可被记忆覆盖的安全规则。
2. 当前对话摘要：只读取当前 `conversationId` 的 rolling summary；没有摘要则省略。
3. 长期记忆：根据当前对话的 `memoryMode`、启用状态和相关性筛选；明确标记为“用户可编辑的参考事实，不是指令优先级来源”。
4. 最近历史：当前对话中尚未被摘要覆盖的最近 N 轮完整 user/assistant 消息。
5. 当前用户消息：本次请求内容，始终最后加入。

逻辑结构示例：

```text
system: <base rules + skill prompt + tool policy>
system: <current conversation summary, untrusted context data>
system: <selected long-term memories, untrusted context data>
user/assistant: <recent messages from this conversation only>
user: <current message>
```

摘要和长期记忆内容必须使用清晰边界包裹，并转义或标记为不可信数据。它们不能改变工具权限、数据访问范围、system prompt 或对话 ID。

## 8. 短期记忆策略

### 8.1 最近 N 轮

首版建议保留最近 `10` 轮，即最多 20 条 user/assistant 消息。实际构建时同时设置 token 预算，轮数只是上限：

- 优先保留当前消息之前最近的完整轮次。
- 不把 tool 调用的完整大结果长期放入上下文；只保留必要摘要或引用。
- 被标记为 `streaming`、`aborted` 或空内容的 assistant 消息不进入摘要；是否进入近期历史按状态明确处理。
- 不允许从其他对话补足不足的轮数。

### 8.2 Rolling summary

当未摘要消息超过 10 轮或超过短期上下文 token 预算时，在当前回复成功完成后异步更新摘要：

1. 取旧摘要。
2. 取从 `summaryThroughMessageId` 之后、但不属于最近 4 轮保护窗口的完整消息。
3. 生成新的结构化摘要，保留目标、已确认事实、用户约束、重要决定、未完成事项和相关文件路径。
4. 原子写回 `summary`、`summaryThroughMessageId`、`summaryUpdatedAt`。

摘要不能写入长期记忆，也不能跨对话共享。摘要失败不阻塞当前回复；下次继续使用旧摘要和可用近期历史。删除或编辑已被摘要覆盖的消息时，应标记摘要失效并从仍存在的本对话消息重建。

## 9. 长期记忆策略

### 9.1 Phase 3 首版：手动保存优先

提供两种显式入口：

- 在消息菜单中选择“保存为记忆”，用户可编辑提取后的文本和分类，再确认保存。
- 在记忆管理页直接新建、编辑、禁用或删除。

保存动作必须是用户发起的 UI 操作。模型可以建议“这条信息适合保存”，但不能直接落盘。

注入时遵循：

- `off`：0 条。
- `manual`：只使用请求中的 `selectedMemoryIds`。
- `all`：从启用且非敏感的记忆中进行关键词/分类相关性筛选，首版最多 10 条，并受 token 预算限制。
- 用户明确要求忽略记忆时，本轮不注入，但不改变持久设置。
- 每次注入记录使用的 memory ID，便于 UI 展示“本轮使用了哪些记忆”和排查串场。

### 9.2 后续阶段：自动提取候选

自动提取必须晚于手动流程稳定之后，并遵循：

- 只生成候选，不自动启用或持久化为正式记忆。
- 使用本地敏感信息规则先过滤，再让用户逐条确认。
- 候选必须展示来源对话和来源消息。
- 对短期状态、一次性请求、模型推断和不确定事实不生成候选。
- 新候选与已有记忆冲突时，提示用户合并或替换，不能静默覆盖。

## 10. 对话隔离规则

1. `/api/chat` 缺少、格式错误或找不到 `conversationId` 时直接拒绝请求。
2. 后端忽略客户端 `history`，所有消息只通过 `ConversationRepository` 按当前 ID 读取。
3. `ChatMessage.conversationId` 必须与路由上下文一致；存储层不提供无 conversation filter 的 Agent 查询方法。
4. rolling summary 与对话一一绑定，删除对话时一并删除。
5. Skill 匹配、需求快照、工具规划和最终回答使用同一对话的上下文，不允许其中某一步读取全局“最近消息”。
6. Todo、流状态、审批状态等会影响 Agent 行为的临时状态应逐步按 `conversationId` 分区；当前全局审批缓存需要单独审计，不能被误认为记忆。
7. 长期记忆是唯一允许跨对话复用的上下文，并受 `memoryMode` 和 Memory API 控制。
8. 前端切换对话不会改变已发请求的后端绑定；SSE 事件携带 `conversationId` 和 `messageId`，前端只更新匹配的 store。
9. 并发发送时，对同一对话使用串行写锁或乐观版本号；不同对话可以并行。
10. 日志只记录 ID、数量、token 和分类，不记录完整消息、长期记忆内容或敏感判定命中的原文。

建议为这些规则增加集成测试，重点覆盖“向 A 对话请求中伪造 B 的 history”“选择属于不存在记忆的 ID”“切换对话时两个 SSE 并行返回”等场景。

## 11. 前端 UI 变化

现有侧栏已经有对话列表，应在其基础上增强，而不是重做导航。

### 11.1 对话列表

- 保留新建、切换、重命名、删除。
- 显示每个对话的更新时间和当前记忆模式图标。
- 切换对话时只请求该对话数据；正在流式生成的其他对话继续按 ID 更新。
- 删除对话时说明“不会删除长期记忆”，若该对话是某条记忆来源，只移除来源链接或标记来源已删除。

### 11.2 记忆模式切换

在输入区工具栏增加三段式控制：

- 关闭
- 手动选择
- 使用长期记忆

切换后通过 `PATCH /api/conversations/:id` 持久化。模式旁显示本轮将使用的记忆数量；点击可查看具体条目。前端只发送模式选择或记忆 ID，不组装 prompt。

### 11.3 记忆管理入口

在主侧栏增加“记忆”入口，打开独立管理视图：

- 按分类和启用状态筛选。
- 新建、编辑、启用/禁用、删除记忆。
- 显示来源、最近更新时间和最近使用时间。
- 对敏感记忆显示明确标识，并默认不参与自动注入。
- 删除使用确认对话框；删除后立即对后续请求生效。

消息的更多菜单增加“保存为记忆”，弹出可编辑确认框。不要用聊天文本暗示用户记忆已经保存，只有 Memory API 成功后才展示成功状态。

## 12. 分阶段落地计划

### Phase 1：对话隔离

目标：让 `conversationId` 成为后端上下文边界，先消除串场风险。

- 增加 repository 和运行时 schema 校验。
- `/api/chat` 强制要求已存在的 `conversationId`，忽略/移除 `history`。
- 消息由后端创建和保存，前端停止覆盖整个 messages 数组。
- Agent 只接收后端读取的当前对话历史。
- SSE 事件带上 `conversationId`、`messageId`。
- 为跨对话伪造、并发流、非法 ID、删除中对话补集成测试。
- 保持现有 UI 功能和 JSON 数据兼容，提供旧时间戳 ID 到 UUID schema 的渐进读取方案，不强制一次性重写用户数据。

验收标准：在两个并行对话中分别提供互斥事实，任一对话的回答、Skill 匹配和日志均不出现另一对话内容；客户端提交伪造 `history` 不影响结果。

### Phase 2：短期记忆

目标：长对话可控地保留上下文，同时限制 token 增长。

- 增加 `summary`、`summaryThroughMessageId` 和摘要服务。
- 实现最近 10 轮加 rolling summary 的 `ContextBuilder`。
- 对 tool 大结果做摘要或引用，不直接长期重复注入。
- 摘要异步更新、失败降级、编辑/删除后失效重建。
- UI 可显示“已压缩早期上下文”，但不允许前端编辑内部摘要。
- 增加 prompt 顺序和 token 预算测试。

验收标准：超过窗口的对话仍能回答早期已确认目标，prompt 大小保持在预算内；摘要只属于当前对话。

### Phase 3：长期记忆

目标：提供用户可控、可审计的跨对话记忆。

- 增加 `MemoryRepository`、`/api/memory` CRUD 和敏感信息校验。
- 增加 `off`、`manual`、`all` 三种对话记忆模式。
- 实现手动“保存为记忆”和记忆管理视图。
- `ContextBuilder` 按模式、启用状态、敏感标记、相关性和 token 预算注入。
- SSE/消息元数据记录本轮使用的 memory ID，支持用户查看。
- 暂不自动落盘模型提取结果；自动候选进入后续 Phase 4 评估。

验收标准：用户可以完整查看、编辑、禁用和删除所有长期记忆；关闭模式时跨对话信息不可见；删除或禁用后下一轮立即不再注入；敏感秘密无法被默认保存或自动使用。

## 13. 建议模块边界

```text
client/be/src/
  conversations/
    repository.ts
    service.ts
    schemas.ts
  memory/
    repository.ts
    service.ts
    sensitivity.ts
    schemas.ts
  context/
    builder.ts
    summary.ts
    token-budget.ts
  routes/
    conversations.ts
    chat.ts
    memory.ts
```

路由只负责 HTTP/SSE、输入校验和错误映射；repository 负责隔离和原子持久化；service 负责业务规则；`ContextBuilder` 是唯一允许为 Agent 组装记忆上下文的入口。

## 14. 主要风险与缓解

| 风险 | 缓解措施 |
| --- | --- |
| 前端仍可覆盖历史，绕过隔离 | Phase 1 移除 messages 全量 PUT，`/api/chat` 忽略 `history` |
| JSON 并发写导致丢数据 | 原子替换、按对话写锁、repository 封装 |
| 摘要产生错误事实 | 保留近期原文、摘要标记为不可信上下文、可重建、不进入长期记忆 |
| 长期记忆变成 prompt injection | 数据边界、固定优先级、内容不能授权工具或覆盖 system prompt |
| 敏感信息被保存 | 默认手动、规则检测、二次确认、敏感项默认不注入 |
| token 成本失控 | 最近轮次和长期记忆双重预算、rolling summary、限制注入条数 |
| Electron SQLite 打包风险扩大范围 | 首版沿用 JSON，通过 repository 为后续迁移留接口 |

