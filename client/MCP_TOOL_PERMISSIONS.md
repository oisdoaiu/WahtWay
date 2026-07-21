# MCP Tool Permission Design

## Goal

Replace the server-wide `requireApproval` switch with explicit per-tool policy while preserving compatibility with existing MCP server configuration.

Each discovered tool resolves to one of three modes:

```text
auto       Registered and callable without per-call confirmation.
confirm    Registered, but every call requires a one-time user approval.
disabled   Not registered in the Agent Tool Registry.
```

The backend is authoritative. The frontend edits policy and displays effective state, but it never decides whether a tool may execute.

## Configuration

```ts
type McpToolPermission = "auto" | "confirm" | "disabled";

interface McpServerConfig {
  // Existing fields omitted.
  defaultToolPermission: McpToolPermission;
  toolPermissions: Record<string, McpToolPermission>;
  schemaVersion: 2;
}
```

`toolPermissions` is keyed by the original MCP tool name. The effective permission is:

```text
toolPermissions[toolName] ?? defaultToolPermission
```

Unknown tools discovered after a server upgrade therefore receive the explicit server default. The default remains `confirm` unless the user changes it.

## Compatibility

Existing schema version 1 configuration is read without a destructive migration step:

```text
requireApproval = true   -> defaultToolPermission = confirm
requireApproval = false  -> defaultToolPermission = auto
missing value            -> defaultToolPermission = confirm
```

The next successful write stores schema version 2 and removes the need for `requireApproval`. API responses use only the new fields.

## Runtime Enforcement

At discovery time, every MCP tool is retained in runtime status with its effective permission.

- `auto`: create and register a `ToolDef` that invokes MCP directly.
- `confirm`: create and register a `ToolDef` that emits `MCP_PERMISSION_REQUIRED`.
- `disabled`: expose metadata in the MCP management UI, but do not create a `ToolDef`.

This prevents disabled tools from being included in the model's function list. A disabled tool cannot be invoked through a forged Agent tool name because it is absent from the registry.

Changing a permission while the server is running performs a controlled restart:

```text
capture running state
  -> stop and unregister old tools
  -> persist permission
  -> start and rediscover tools
  -> register according to new effective policy
```

If restart fails, the new policy remains persisted and the server reports an error. It never falls back to the previous, more permissive registration.

## API

```text
PATCH /api/mcp/servers/:id/tool-permissions/default
PATCH /api/mcp/servers/:id/tool-permissions/:toolName
DELETE /api/mcp/servers/:id/tool-permissions/:toolName
```

Request body:

```json
{
  "permission": "auto"
}
```

Deleting a tool override returns it to the server default.

The list and detail APIs return effective permission on every discovered tool:

```ts
interface McpToolSummary {
  name: string;
  registeredName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  permission: McpToolPermission;
  overridden: boolean;
}
```

## Frontend

The MCP server editor controls the default policy. The old `requireApproval` checkbox is removed.

Each discovered tool row includes a select control:

```text
Use server default (<effective value>)
Auto
Confirm each call
Disabled
```

The UI distinguishes inherited and overridden policy. Changing a running server permission warns through busy state while the backend restarts it.

## Validation

- Legacy `requireApproval` migration test.
- Repository validation for invalid modes and unknown override values.
- Runtime test proving `auto` invokes immediately.
- Runtime test proving `confirm` requires a one-time token.
- Runtime test proving `disabled` is absent from Tool Registry.
- API smoke test for live permission changes and restart.
- Frontend and backend production builds.

