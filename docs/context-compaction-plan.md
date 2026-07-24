# V0.21 — 对话上下文压缩（Context Compaction）实施方案

> **状态：已实现（2026-07-24）** ✅ —— 代码已落地，前后端类型检查/打包通过。
> 目标：**每次对话都常态化压缩、用户完全无感**。LLM 永远只看到"一段长期记忆(summary) + 最近几轮原文"，上下文长度被钉死，不随对话变长而膨胀。
> 依据：TODO.md #39（Context 编辑/Compaction）。
> 范围：纯增量增强，**默认不弹摘要卡、不改前端渲染**，用户感知不到压缩存在。

---

## 0. 现状与痛点（已核实代码）

| 位置 | 现状 |
|------|------|
| 前端 `client/src/App.tsx:161` | 每次发送：`history = currentMessages.map(m => ({role, content}))` —— **全量**发给后端 |
| 后端 `client/be/src/agent.ts:88-94` | `history` 原样 push 进 `messages` 后调 LLM —— **无长度限制、无压缩** |
| 存储 `client/be/src/routes/conversations.ts` | 完整消息存 `client/data/conversations/{id}.json`；仅标题有 AI 摘要，正文从不摘要 |
| 已有资产 | ① `/api/conversations/:id/summarize`（标题摘要，可复用模型/客户端）<br>② Agent 笔记目录 `~/.wahtway-notes/`（V0.18）<br>③ `logger` + traceId（V0.12） |

**风险**：超长对话 → prompt token 超窗口、费用/延迟线性增长、工具冗长中间结果反复占上下文。

---

## 1. 设计原则（无感优先）

1. **每次都压，但无感**：压缩是常态，不是"快爆了才救火"；用户**看不到**摘要卡，前端只渲染 `messages` 原文。
2. **上下文长度恒定**：LLM 收到的历史 = `summary(长期记忆) + 最近 K 轮原文`，K 固定，所以总长度不随对话增长。
3. **增量更新，不每次烧 token**：`summary` 被缓存复用；只有当"窗口外又累积了 M 轮"时才增量合并一次（默认每 6 轮 1 次 LLM 调用），平时零额外调用。
4. **摘要即隐形记忆**：`summary` 作为 `role:"system"` 注入，不进 `messages`、不渲染。
5. **可回滚**：`COMPACT_ENABLED=false` 时完全等价于今天的"全量 history"。

---

## 2. 核心机制：滚动窗口 + 常驻摘要

```
messages (完整原文, 全量存盘, 前端渲染)
  │
  ├── 最近 K 轮 (RECENT_TURNS)  ──┐
  │                              ├──→  喂给 LLM 的 history
  └── 更早的 (窗口外) ──┐        │      = [summary(system), ...最近K轮, 当前消息]
                       │        │
                  summary ──────┘   (长期记忆, 随对话增量更新)

摘要更新触发：窗口外消息数 % SUMMARY_EVERY == 0 时，把"刚移出窗口的那 M 轮"合并进 summary（1 次 LLM 调用）
```

**为什么无感**：
- 用户看到的聊天记录 = `messages` 原文，和今天完全一样；
- 摘要卡**不展示**，只在后端流动；
- 平时零额外 LLM 调用，只有每 M 轮才悄悄更新一次记忆。

---

## 3. 具体改动点

### 3.1 存储结构升级 `client/be/src/routes/conversations.ts`
`conversations/{id}.json` 增加 `summary` 字段：
```json
{ "id", "title", "messages": [...], "summary": "早期对话的压缩记忆" }
```
- `GET /:id`：返回时带 `summary`；
- `PUT /:id`：`body` 支持 `summary` 字段，随 `messages` 一起存盘；
- 旧文件无 `summary` → 默认 `""`，兼容。

### 3.2 新增 `client/be/src/context/compactor.ts`
- `estimateTokens(messages)`：粗略估算（中文 ~1.5 token/字，英文 ~0.25/词）。
- `buildCompactHistory(messages, summary, opts)`：
  - 取最近 `RECENT_TURNS` 条作为 `recent`；
  - 返回 `{ history: [{role:"system", content: SUMMARY_PREFIX+summary}, ...recent], needsUpdate, updateFrom }`；
  - `needsUpdate = (messages.length - RECENT_TURNS) > 0 且 (窗口外轮数 % SUMMARY_EVERY == 0)`；
  - `updateFrom` = 需要合并进 summary 的那批旧消息。
- `mergeSummary(oldSummary, batch)`：调 DeepSeek（复用 resolveModel + openai 客户端）把 `oldSummary + batch` 压成新 summary。prompt 强调"保留决策/结论/待办/用户偏好/未完成事项，丢弃冗余细节与重复工具输出"。
- 容错：合并失败 → 返回旧 summary，打 warn 日志（traceId 可追踪），不阻断。

### 3.3 接入 `client/be/src/agent.ts`
- `runAgentStream` / `agenticLoopStream` 增加 `summary?: string` 参数；
- 构造 `messages` 前：
  ```ts
  const { history, needsUpdate, updateFrom } = buildCompactHistory(currentMessages, summary);
  // 若 needsUpdate：await mergeSummary(...) 拿到新 summary，随 SSE 的 stats/done 事件回传前端，前端 PUT 存盘
  ```
- `history` 中的 system 摘要 + 最近原文替代原来的全量 `history`。

### 3.4 前端 `client/src/App.tsx`（最小改动）
- `:161` 处：把本地 `messages` 和后端返回的 `summary` 一起发给 `/api/chat`：
  ```ts
  body: JSON.stringify({ message: text, history: rawHistory, summary: currentSummary, ... })
  ```
- 收到 `done`/`stats` 事件若带 `newSummary` → 存到 `conversations` store 的 `summary` 字段，下次发送自动带上；并 `PUT /api/conversations/:id` 持久化。
- **不渲染 summary**，用户无感。

### 3.5 `conversations.ts` store（前端）增加 `summary` 字段
- `getOrCreate` 增加 `summary: ""`；
- 新增 `getSummary(id)` / `setSummary(id, s)`；
- 切对话加载时从 `GET /:id` 取 `summary`。

---

## 4. 配置项（可热调，不硬编码）`client/.env` + `env.ts`
```
COMPACT_ENABLED=true          # 总开关，false = 完全等价现状
COMPACT_MODE=rolling          # rolling(无感常压) / threshold(原阈值方案，备用)
COMPACT_RECENT_TURNS=6        # 保留最近原文轮数（钉死上下文长度）
COMPACT_SUMMARY_EVERY=6       # 每多6轮增量更新一次 summary
```
`env.ts` 读取并提供默认值；`index.ts` 启动日志打印当前配置。

---

## 5. 实施步骤
1. [ ] `conversations.ts`（后端）：`summary` 字段读写 + 旧文件兼容。
2. [ ] `compactor.ts`：`estimateTokens` + `buildCompactHistory`（先做截断逻辑，可单测）。
3. [ ] `compactor.ts`：`mergeSummary` 调 DeepSeek，写摘要 prompt。
4. [ ] `agent.ts`：接入 `summary`，在 `stats`/`done` 事件回传 `newSummary`。
5. [ ] `env.ts`：配置读取 + 启动日志。
6. [ ] 前端 store + `App.tsx`：发/收 `summary`，持久化，**不渲染**。
7. [ ] 单测：短对话(≤K轮)→ 无 summary、零额外调用；长对话 → summary 每 M 轮增量更新；合并失败 → 降级保留旧 summary。
8. [ ] 手动验证：60 轮对话，确认 LLM 收到的总 token 恒定、回复质量不塌、UI 无新增卡片。
9. [ ] 更新 TODO #39、README、版本号 bump。

---

## 6. 验收标准
- 短对话（≤ RECENT_TURNS）：行为与今日完全一致（无 summary、零额外 LLM 调用）。
- 长对话：LLM 收到的总 token **恒定**（≈ summary + K 轮原文），不再随对话线性增长。
- 用户侧：聊天界面与今天一模一样，**无任何摘要卡/提示弹窗**。
- 摘要 LLM 异常：对话不中断，降级保留旧 summary 并打 warn（traceId 可追踪）。
- 切换/刷新：summary 随对话持久化，不重复生成。
- 零新增 npm 依赖（复用 openai 客户端）。

---

## 7. 风险与回滚
- **风险**：摘要丢失关键上下文 → 靠"永远保留最近 K 轮原文"兜底；摘要 prompt 强调保留决策/待办/偏好/未完成事项。
- **回滚**：`COMPACT_ENABLED=false` 一键回退全量 history；配置即开关，无需改代码。
- **成本**：每 M 轮 1 次摘要调用（默认 6 轮 1 次），相比省下的主对话 token 净赚；且摘要调用可用最便宜的 flash 模型。

---

_规划日期：2026-07-24｜基于代码实测（agent.ts / chat.ts / conversations.ts / App.tsx）。方案：无感滚动压缩（每次对话都压，常驻 summary，增量更新，UI 无感）。_
