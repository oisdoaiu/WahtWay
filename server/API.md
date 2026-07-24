# WahtWay Skill Hub API

Skill Hub 负责在线发布、发现、版本化下载 Skill。客户端仍然把下载后的 Skill 保存到本地 `client/be/data/skills`，所以用户可以离线继续使用。

启动服务后访问 `http://localhost:4000/` 可以打开简约管理界面。

## 环境变量

- `PORT`: 服务端口，默认 `4000`
- `SKILL_HUB_DATA_DIR`: Hub 持久化目录，默认 `server/data/hub`
- `REQUIRE_SKILL_REVIEW`: 设置为 `true` 时，新上传 Skill 默认为 `pending`
- `ALLOWED_SKILL_TOOLS`: 逗号分隔的工具白名单，默认不允许上传声明外部工具的 Skill
- `SKILL_HUB_ADMIN_TOKEN`: 管理员令牌。必须配置；上传、发布版本、修改元数据和归档 Skill 都需要在请求中携带它。

## 管理员鉴权

公开的查询、下载、评分和举报接口不需要令牌。会改变 Skill 内容或状态的接口需要 HTTP Bearer Token：

```txt
Authorization: Bearer <SKILL_HUB_ADMIN_TOKEN>
```

例如：

```bash
curl -X POST https://hub.example.com/api/skills \
  -H "Authorization: Bearer $SKILL_HUB_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data @skill.json
```

未配置 `SKILL_HUB_ADMIN_TOKEN` 时，受保护接口会返回 `503`，以避免服务器意外以公开写入模式运行。网页上传功能会在当前浏览器会话中询问令牌；令牌不会写入仓库或持久化到磁盘。

## 查询与下载

```txt
GET /api/health
GET /api/skills?q=&tag=&category=&sort=latest|downloads|rating|name
GET /api/skills/:skillId
GET /api/skills/:skillId/versions
GET /api/skills/:skillId/download?version=latest
```

下载响应：

```json
{
  "skill": {},
  "version": "1.0.0",
  "checksum": "sha256...",
  "source": {
    "hub": "WahtWay Skill Hub",
    "skillId": "daily-study-plan"
  }
}
```

如需兼容旧客户端，可以请求：

```txt
GET /api/skills/:skillId/download?format=raw
```

## 上传

```txt
POST /api/skills
```

```json
{
  "manifest": {
    "id": "essay-outline",
    "name": "论文大纲助手",
    "description": "根据主题生成论文大纲",
    "systemPrompt": "你是一个论文大纲助手......",
    "input": {
      "type": "object",
      "properties": {
        "topic": { "type": "string", "description": "论文主题" }
      },
      "required": ["topic"]
    },
    "output": {
      "type": "object",
      "properties": {}
    },
    "requiredTools": [],
    "keywords": ["论文", "大纲", "写作"]
  },
  "version": "1.0.0",
  "changelog": "首次发布",
  "authorName": "作者名",
  "category": "学习",
  "tags": ["写作", "学习"],
  "visibility": "public"
}
```

## 版本、管理与信任

```txt
POST   /api/skills/:skillId/versions
PATCH  /api/skills/:skillId
DELETE /api/skills/:skillId
POST   /api/skills/:skillId/review
POST   /api/skills/:skillId/report
```

`DELETE` 采用软删除，会把 Skill 标记为 `archived`。列表接口不会暴露完整 `systemPrompt`，只有下载接口返回完整 Skill manifest。
