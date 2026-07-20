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

async function saveFixtureServer(requireApproval: boolean) {
  const repository = await import("./repository");
  return repository.saveMcpServer({
    id: requireApproval ? "approval-fixture" : "echo-fixture",
    name: "Echo Fixture",
    description: "Local MCP fixture",
    command: process.execPath,
    args: [fixturePath],
    cwd: path.dirname(fixturePath),
    env: { FIXTURE_SECRET: "${FIXTURE_TOKEN}" },
    enabled: true,
    autoStart: false,
    requireApproval,
    toolCallTimeoutMs: 5000,
  });
}

describe("MCP stdio runtime", () => {
  it("discovers, registers, invokes, and unregisters tools", async () => {
    const repository = await import("./repository");
    const runtime = await import("./runtime");
    const registry = await import("../tools/registry");
    const server = await saveFixtureServer(false);
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
    const server = await saveFixtureServer(true);
    repository.setMcpSecret(server.id, "FIXTURE_TOKEN", "hidden-value");
    await runtime.startMcpServer(server.id);

    const tool = registry.getTool("mcp-approval-fixture-echo");
    const pending = await tool!.execute({ text: "approved" });
    expect(pending).toMatch(/^MCP_PERMISSION_REQUIRED::approval-fixture::echo::/);
    const token = pending.split("::")[3];

    await expect(runtime.executeApprovedMcpTool(token)).resolves.toBe("echo:approved");
    await expect(runtime.executeApprovedMcpTool(token)).rejects.toThrow("审批已失效");
  });
});
