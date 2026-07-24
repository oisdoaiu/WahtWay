# WahtWay Skill Hub API

Skill Hub 负责在线发布、发现、版本化下载 Skill。客户端仍然把下载后的 Skill 保存到本地 `client/be/data/skills`，所以用户可以离线继续使用。

启动服务后访问 `http://localhost:4000/` 可以打开简约管理界面。

## 环境变量

- `PORT`: 服务端口，默认 `4000`
- `SKILL_HUB_DATA_DIR`: Hub 持久化目录，默认 `server/data/hub`
- `AUTH_TOKEN_SECRET`: token 签名密钥；未设置时服务端会在数据目录生成 `auth-secret.txt`
- `REQUIRE_SKILL_REVIEW`: 设置为 `true` 时，新上传 Skill 默认为 `pending`
- `ALLOWED_SKILL_TOOLS`: 逗号分隔的工具白名单，默认不允许上传声明外部工具的 Skill

## 登录

上传、更新版本、修改和删除 Skill 都由服务端校验登录权限。请求这些接口时需要携带：

```txt
Authorization: Bearer <token>
```

```txt
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
```

注册请求：

```json
{
  "username": "alice",
  "displayName": "Alice",
  "password": "password123"
}
```

登录和注册都会返回：

```json
{
  "user": {
    "id": "user-id",
    "username": "alice",
    "displayName": "Alice",
    "role": "user",
    "createdAt": "2026-07-16T00:00:00.000Z"
  },
  "token": "signed-token"
}
```

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

该接口必须登录。作者信息由服务端从登录用户写入，客户端传入的 `authorName` 不会被信任。

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

新增版本、修改和删除仅允许 Skill 作者或 admin 操作。`DELETE` 采用软删除，会把 Skill 标记为 `archived`。列表接口不会暴露完整 `systemPrompt`，只有下载接口返回完整 Skill manifest。
