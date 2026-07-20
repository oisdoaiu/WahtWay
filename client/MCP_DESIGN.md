# WahtWay MCP Connector MVP Design

## Scope

The first MCP release supports local stdio servers only. WahtWay starts the configured process, performs the MCP initialize handshake, discovers tools, and exposes them through the existing Agent Tool Registry.

Included:

- Local stdio server configuration and persistence.
- Explicit start, stop, restart, and connection testing.
- Tool discovery with pagination.
- MCP tool registration in the existing Agent loop.
- Tool call timeout and bounded text/structured result formatting.
- Per-server enable state and environment variable names.
- Frontend server list and editor.
- Runtime status and last error visibility.

Deferred:

- Streamable HTTP and legacy SSE transports.
- OAuth and remote server authentication.
- MCP resources, prompts, sampling, elicitation, and experimental tasks.
- Automatic package installation.
- Automatic server startup immediately after creating an unreviewed command.
- Passing the full parent environment to child processes.

## Configuration

```ts
interface McpServerConfig {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  cwd: string | null;
  env: Record<string, string>;
  enabled: boolean;
  autoStart: boolean;
  requireApproval: boolean;
  toolCallTimeoutMs: number;
  createdAt: string;
  updatedAt: string;
  schemaVersion: 1;
}
```

The environment map supports `${SECRET_NAME}` references. Secret values are stored separately and are never returned by APIs. Child processes receive a minimal inherited environment plus the explicitly configured values.

MCP tool calls require per-call user approval by default. A user may explicitly disable this for a trusted server.

Runtime status is not persisted:

```ts
interface McpServerStatus {
  state: "stopped" | "starting" | "running" | "error";
  tools: McpToolSummary[];
  startedAt: string | null;
  lastError: string | null;
}
```

## Tool Naming

Discovered MCP tools are registered as:

```text
mcp-<server-id>-<tool-name>
```

IDs are normalized to the function-calling compatible character set and capped at 64 characters. A collision after normalization prevents that server from starting instead of silently replacing another tool.

The registered `ToolDef` retains the MCP tool description and JSON input schema. Invocation forwards the model-produced arguments unchanged to `client.callTool()`.

## Lifecycle

```text
saved config
    -> user starts server or enabled autoStart runs at boot
    -> StdioClientTransport spawns child
    -> Client.connect performs initialize handshake
    -> listTools discovers all pages
    -> tools register in WahtWay Tool Registry
    -> Agent can call mcp-<server>-<tool>
    -> stop/exit/error unregisters all server tools
```

Only one start or stop operation may run for a server at a time. Configuration changes stop the active process before replacing its definition.

## Process Security

- The backend executes only the saved command and argument array; it never builds a shell command string.
- Stdio transport launches the process without a shell.
- `cwd` must resolve to an existing directory when supplied.
- Environment variable names are validated.
- The child receives only a minimal allowlist from the parent environment plus configured values.
- Secrets stay in the backend and are injected immediately before process start.
- stderr is bounded and used only for status diagnostics.
- Stopping a server calls `client.close()`, which owns transport and process shutdown.
- Deleting a running server stops it before deleting configuration and secrets.

MCP servers are executable local code. The UI must state the exact command, arguments, working directory, and environment variable names before the user starts one.

## APIs

```text
GET    /api/mcp/servers
POST   /api/mcp/servers
GET    /api/mcp/servers/:id
PATCH  /api/mcp/servers/:id
DELETE /api/mcp/servers/:id

POST   /api/mcp/servers/:id/start
POST   /api/mcp/servers/:id/stop
POST   /api/mcp/servers/:id/restart
POST   /api/mcp/servers/:id/test

PUT    /api/mcp/servers/:id/secrets/:name
DELETE /api/mcp/servers/:id/secrets/:name
```

List and detail responses combine persisted configuration with transient runtime status. Secret values are never included.

## Result Formatting

MCP call results may contain text, images, resources, or structured content. The MVP returns:

1. `structuredContent`, serialized as JSON when present.
2. Text content blocks.
3. A compact placeholder for unsupported blocks, including their type.

The combined result is capped before being returned to the Agent. `isError: true` is converted into an error-prefixed tool result while preserving bounded server-provided detail.

## Frontend

The MCP page provides:

- Server rows with stopped, starting, running, or error state.
- Add and edit form for command, arguments, cwd, env templates, timeout, enable, and auto-start.
- Explicit start, stop, restart, test, and delete controls.
- Discovered tool names and descriptions.
- Secret name management without value readback.
- Last runtime error.

The form uses an argument list rather than a command-line text parser. This keeps executable and arguments distinct across Windows, macOS, and Linux.

## Validation

- Repository tests for config and secret redaction.
- Runtime tests against a local fixture MCP stdio server.
- Tool registration and invocation test.
- Duplicate start and stop test.
- Process exit cleanup test.
- API lifecycle smoke test.
- Frontend and backend production builds.
