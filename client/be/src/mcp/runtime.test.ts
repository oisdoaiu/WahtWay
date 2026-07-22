import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixturePath = fileURLToPath(new URL("./fixtures/echo-server.cjs", import.meta.url));
const crashFixturePath = fileURLToPath(new URL("./fixtures/crash-server.cjs", import.meta.url));
const dynamicToolsFixturePath = fileURLToPath(new URL("./fixtures/dynamic-tools-server.cjs", import.meta.url));
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

  it("updates health metrics after a successful ping", async () => {
    const repository = await import("./repository");
    const runtime = await import("./runtime");
    const server = await saveFixtureServer("auto");
    repository.setMcpSecret(server.id, "FIXTURE_TOKEN", "hidden-value");
    await runtime.startMcpServer(server.id);

    const status = await runtime.checkMcpHealth(server.id);
    expect(status.state).toBe("running");
    expect(status.lastHealthCheckAt).not.toBeNull();
    expect(status.consecutiveFailures).toBe(0);
  });

  it("reconnects an auto-start server after its process exits", async () => {
    const repository = await import("./repository");
    const runtime = await import("./runtime");
    const registry = await import("../tools/registry");
    const server = repository.saveMcpServer({
      id: "crash-fixture",
      name: "Crash Fixture",
      description: "Reconnect fixture",
      command: process.execPath,
      args: [crashFixturePath],
      cwd: path.dirname(crashFixturePath),
      env: {}, enabled: true, autoStart: true,
      defaultToolPermission: "auto", toolPermissions: {}, toolCallTimeoutMs: 5000,
    });
    await runtime.startMcpServer(server.id);
    await registry.getTool("mcp-crash-fixture-crash")!.execute({});

    const deadline = Date.now() + 6000;
    let observedReconnect = false;
    while (Date.now() < deadline) {
      const status = runtime.getMcpStatus(server.id);
      if (status.state === "reconnecting") observedReconnect = true;
      if (observedReconnect && status.state === "running") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(observedReconnect).toBe(true);
    expect(runtime.getMcpStatus(server.id).state).toBe("running");
    expect(registry.getTool("mcp-crash-fixture-crash")).not.toBeNull();
  }, 10000);

  it("refreshes registered tools after a list changed notification", async () => {
    const repository = await import("./repository");
    const runtime = await import("./runtime");
    const registry = await import("../tools/registry");
    const server = repository.saveMcpServer({
      id: "dynamic-tools-fixture",
      name: "Dynamic Tools Fixture",
      description: "Tool list notification fixture",
      command: process.execPath,
      args: [dynamicToolsFixturePath],
      cwd: path.dirname(dynamicToolsFixturePath),
      env: {}, enabled: true, autoStart: false,
      defaultToolPermission: "auto", toolPermissions: {}, toolCallTimeoutMs: 5000,
    });
    await runtime.startMcpServer(server.id);
    const toggleName = "mcp-dynamic-tools-fixture-toggle-tools";
    const dynamicName = "mcp-dynamic-tools-fixture-dynamic-echo";

    await registry.getTool(toggleName)!.execute({});
    const addedDeadline = Date.now() + 3000;
    while (!registry.getTool(dynamicName) && Date.now() < addedDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(runtime.getMcpStatus(server.id).toolListRevision).toBe(2);
    await expect(registry.getTool(dynamicName)!.execute({ text: "hello" })).resolves.toBe("dynamic:hello");

    await registry.getTool(toggleName)!.execute({});
    const removedDeadline = Date.now() + 3000;
    while (registry.getTool(dynamicName) && Date.now() < removedDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(runtime.getMcpStatus(server.id).toolListRevision).toBe(3);
    expect(registry.getTool(dynamicName)).toBeNull();
  }, 10000);
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
