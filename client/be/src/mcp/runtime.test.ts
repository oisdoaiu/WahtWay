import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixturePath = fileURLToPath(new URL("./fixtures/echo-server.cjs", import.meta.url));
let dataDir = "";

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wahtway-mcp-test-"));
  process.env.WAHTWAY_DATA_DIR = dataDir;
  vi.resetModules();
});

afterEach(async () => {
  const runtime = await import("./runtime");
  await runtime.stopAllMcpServers();
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.WAHTWAY_DATA_DIR;
  vi.resetModules();
});

async function saveFixtureServer(defaultToolPermission: "auto" | "confirm" | "disabled") {
  const repository = await import("./repository");
  return repository.saveMcpServer({
    id: defaultToolPermission === "confirm" ? "approval-fixture" : "echo-fixture",
    name: "Echo Fixture",
    description: "Local MCP fixture",
    command: process.execPath,
    args: [fixturePath],
    cwd: path.dirname(fixturePath),
    env: { FIXTURE_SECRET: "${FIXTURE_TOKEN}" },
    enabled: true,
    autoStart: false,
    defaultToolPermission,
    toolPermissions: {},
    toolCallTimeoutMs: 5000,
  });
}

describe("MCP stdio runtime", () => {
  it("discovers, registers, invokes, and unregisters tools", async () => {
    const repository = await import("./repository");
    const runtime = await import("./runtime");
    const registry = await import("../tools/registry");
    const server = await saveFixtureServer("auto");
    repository.setMcpSecret(server.id, "FIXTURE_TOKEN", "hidden-value");

    const started = await runtime.startMcpServer(server.id);
    expect(started.state).toBe("running");
    expect(started.tools).toHaveLength(1);
    expect(started.tools[0].registeredName).toBe("mcp-echo-fixture-echo");

    const tool = registry.getTool("mcp-echo-fixture-echo");
    expect(tool).not.toBeNull();
    await expect(tool!.execute({ text: "hello" })).resolves.toBe("echo:hello");

    const publicServer = runtime.listPublicMcpServers()[0];
    expect(publicServer.secretNames).toEqual(["FIXTURE_TOKEN"]);
    expect(JSON.stringify(publicServer)).not.toContain("hidden-value");

    await runtime.stopMcpServer(server.id);
    expect(registry.getTool("mcp-echo-fixture-echo")).toBeNull();
    expect(runtime.getMcpStatus(server.id).state).toBe("stopped");
  });

  it("uses an expiring one-time approval before invoking tools", async () => {
    const repository = await import("./repository");
    const runtime = await import("./runtime");
    const registry = await import("../tools/registry");
    const server = await saveFixtureServer("confirm");
    repository.setMcpSecret(server.id, "FIXTURE_TOKEN", "hidden-value");
    await runtime.startMcpServer(server.id);

    const tool = registry.getTool("mcp-approval-fixture-echo");
    const pending = await tool!.execute({ text: "approved" });
    expect(pending).toMatch(/^MCP_PERMISSION_REQUIRED::approval-fixture::echo::/);
    const token = pending.split("::")[3];

    await expect(runtime.executeApprovedMcpTool(token)).resolves.toBe("echo:approved");
    await expect(runtime.executeApprovedMcpTool(token)).rejects.toThrow("审批已失效");
  });

  it("keeps disabled tools out of the Agent registry", async () => {
    const repository = await import("./repository");
    const runtime = await import("./runtime");
    const registry = await import("../tools/registry");
    const server = await saveFixtureServer("auto");
    repository.setMcpSecret(server.id, "FIXTURE_TOKEN", "hidden-value");
    repository.saveMcpServer({
      ...server,
      toolPermissions: { echo: "disabled" },
    });

    const started = await runtime.startMcpServer(server.id);
    expect(started.tools[0]).toMatchObject({
      name: "echo",
      permission: "disabled",
      overridden: true,
    });
    expect(registry.getTool("mcp-echo-fixture-echo")).toBeNull();
  });

  it("allows a confirm override on an auto server", async () => {
    const repository = await import("./repository");
    const runtime = await import("./runtime");
    const registry = await import("../tools/registry");
    const server = await saveFixtureServer("auto");
    repository.setMcpSecret(server.id, "FIXTURE_TOKEN", "hidden-value");
    repository.saveMcpServer({ ...server, toolPermissions: { echo: "confirm" } });
    await runtime.startMcpServer(server.id);

    const pending = await registry.getTool("mcp-echo-fixture-echo")!.execute({ text: "override" });
    expect(pending).toMatch(/^MCP_PERMISSION_REQUIRED::echo-fixture::echo::/);
  });
});

describe("MCP permission config migration", () => {
  it("maps legacy requireApproval and writes schema version 2 on save", async () => {
    const directory = path.join(dataDir, "mcp-servers");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "servers.json"), JSON.stringify({
      schemaVersion: 1,
      servers: [{
        id: "legacy-server",
        name: "Legacy",
        description: "Legacy config",
        command: process.execPath,
        args: [],
        cwd: null,
        env: {},
        enabled: true,
        autoStart: false,
        requireApproval: false,
        toolCallTimeoutMs: 5000,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        schemaVersion: 1,
      }],
    }), "utf-8");

    const repository = await import("./repository");
    const migrated = repository.listMcpServers()[0];
    expect(migrated.defaultToolPermission).toBe("auto");
    expect(migrated.toolPermissions).toEqual({});

    repository.saveMcpServer(migrated);
    const stored = JSON.parse(fs.readFileSync(path.join(directory, "servers.json"), "utf-8"));
    expect(stored.servers[0].schemaVersion).toBe(2);
    expect(stored.servers[0].requireApproval).toBeUndefined();
  });
});
