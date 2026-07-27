# WahtWay Skill Manifest v1

本文档定义 WahtWay 内部统一的 Skill JSON 格式。后续从 GitHub、Skill Hub 或其他来源接入 Skill 时，建议先转换成这个 Manifest，再交给本地保存、模式切换、Hub 发布或运行逻辑处理。

## 文件约定

- 文件编码：UTF-8。
- 文件扩展名：`.json`。
- 文件名：与 `id` 保持一致，例如 `daily-study-plan.json`。
- `id` 使用 kebab-case：只允许小写字母、数字和连字符。
- 单个 Skill JSON 建议不超过 256KB。

## 字段分层

### 核心字段

这些字段是运行、匹配、展示都需要的稳定字段。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | Skill 唯一 ID，kebab-case，3-64 字符。 |
| `name` | string | 是 | 展示名称，建议中文，1-80 字符。 |
| `description` | string | 是 | 一句话说明能力，1-500 字符。 |
| `systemPrompt` | string | 是 | Skill 的核心行为提示词，20-20000 字符。 |
| `input` | object | 是 | 输入 JSON Schema 子集。 |
| `output` | object | 是 | 输出 JSON Schema 子集。 |
| `requiredTools` | string[] | 是 | 强依赖工具。没有则填 `[]`。 |
| `keywords` | string[] | 是 | 匹配关键词，建议 5-30 个。 |

### 本地运行字段

这些字段主要给客户端本地 Agent、自动匹配和工具权限使用。GitHub 接入时如果没有，可以按默认值补齐。

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `allowedTools` | string[] | 否 | `[]` | 允许 Agent 调用的工具白名单。空数组表示不开放额外工具。 |
| `whenToUse` | string | 否 | 根据 `description` 生成 | 更细的触发条件，用于避免误匹配。 |
| `version` | number | 否 | `1` | 本地学习版本号。发布到 Hub 时使用 Hub 的 semver 版本。 |
| `origin` | string | 否 | 按来源设置 | `builtin`、`custom`、`hub`、`learned` 之一。 |

### 模式切换展示字段

这些字段用于聊天页“切换模式”的视觉展示和快捷示例。

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `modeCategory` | string | 否 | `常用` | 模式分组，例如 `通用`、`学习`、`开发`、`办公创作`、`生活`。 |
| `modeColor` | string | 否 | `#1a73e8` | 主题色，必须是 6 位十六进制颜色。 |
| `modeIcon` | string | 否 | `ri-robot-2-line` | Remix Icon 字体图标类名，例如 `ri-brain-line`，最多 64 字符。 |
| `welcomeMessage` | string | 否 | `description` | 切换到该模式后的欢迎语，建议 160 字符以内。 |
| `modeExamples` | string[] | 否 | `[]` | 快捷示例，最多 4 条，每条 80 字符以内。 |

## Schema 子集

`input` 和 `output` 使用轻量 JSON Schema 子集：

```json
{
  "type": "object",
  "properties": {
    "request": {
      "type": "string",
      "description": "用户本次需求"
    }
  },
  "required": ["request"]
}
```

支持的属性：

- `type`: 字段类型，例如 `object`、`string`、`number`、`boolean`、`array`。
- `properties`: 对象字段定义。
- `required`: 必填字段名数组。
- `enum`: 字符串枚举数组。
- 每个 `properties` 子字段必须包含 `type` 和 `description`。

## 标准示例

```json
{
  "id": "github-issue-helper",
  "name": "GitHub Issue 助手",
  "description": "帮助整理 GitHub Issue、复现步骤和修复建议。",
  "systemPrompt": "你是一个严谨的软件项目协作助手，擅长把零散的问题描述整理成清晰的 GitHub Issue。输出时包含问题摘要、复现步骤、期望结果、实际结果和建议排查方向。",
  "input": {
    "type": "object",
    "properties": {
      "request": {
        "type": "string",
        "description": "用户提供的问题描述或需求"
      }
    },
    "required": ["request"]
  },
  "output": {
    "type": "object",
    "properties": {
      "issue": {
        "type": "string",
        "description": "Markdown 格式的 Issue 内容"
      }
    }
  },
  "requiredTools": [],
  "allowedTools": [],
  "whenToUse": "用户需要整理 GitHub Issue、Bug 反馈、需求描述、复现步骤或项目协作记录时触发。",
  "modeCategory": "开发",
  "modeColor": "#24292f",
  "modeIcon": "ri-github-line",
  "welcomeMessage": "把问题现象、报错或需求发给我，我会整理成适合提交到 GitHub 的 Issue。",
  "modeExamples": [
    "帮我把这个登录报错整理成 GitHub Issue",
    "根据这段反馈写一个 bug 复现模板",
    "帮我把这个需求拆成可执行的 issue"
  ],
  "keywords": ["github", "issue", "bug", "复现", "需求", "协作", "项目"]
}
```

## GitHub Skill 接入转换建议

从 GitHub 接入时，可以按下面规则转换：

| 外部信息 | WahtWay 字段 |
| --- | --- |
| 仓库目录名或 manifest id | `id`，统一转 kebab-case。 |
| README 标题或 manifest name | `name`。 |
| README 简介或 description | `description`。 |
| `SKILL.md` 主体说明 | `systemPrompt`。 |
| 参数说明或示例输入 | `input.properties`。没有结构化参数时使用 `request` 字段。 |
| 输出说明 | `output.properties`。没有结构化输出时使用 `result` 字段。 |
| 工具声明 | `requiredTools` 或 `allowedTools`。无法确认权限时先填 `[]`。 |
| 标签、主题、关键词 | `keywords`、`modeCategory`。 |
| 示例用法 | `modeExamples`，最多保留 4 条。 |

转换时要注意：

- 外部 Skill 的原始说明可以保存在接入模块自己的元数据里，但写入 WahtWay 运行目录时只保存 Manifest。
- 不要把 GitHub token、私有仓库地址、用户本地路径写进 Skill JSON。
- 如果外部 Skill 要求危险工具，先转成 `allowedTools: []`，由用户在本地编辑界面确认后再开放。
- 进入 Skill Hub 发布流程时，Hub 元数据如 `tags`、`category`、`version`、`changelog` 属于发布记录，不属于 Manifest 核心字段。

## 校验

仓库提供了 JSON Schema：

```text
schemas/wahtway-skill-manifest-v1.schema.json
```

也提供了一个无依赖校验脚本：

```bash
node scripts/validate-skill-format.mjs
node scripts/validate-skill-format.mjs client/be/data/skills server/data/skills
```

