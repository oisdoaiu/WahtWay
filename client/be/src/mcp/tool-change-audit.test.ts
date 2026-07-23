import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dataDir = "";

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wahtway-mcp-audit-test-"));
  process.env.WAHTWAY_DATA_DIR = dataDir;
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.WAHTWAY_DATA_DIR;
  vi.resetModules();
});

function tool(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    registeredName: `mcp-fixture-${name}`,
    description: `${name} description`,
    inputSchema: { type: "object", properties: { text: { type: "string" } } },
    permission: "confirm" as const,
    overridden: false,
    ...overrides,
  };
}

describe("MCP tool change audit", () => {
  it("does not report schema object key ordering as a change", async () => {
    const audit = await import("./tool-change-audit");
    const before = tool("echo", {
      inputSchema: { type: "object", properties: { count: { type: "number" }, text: { type: "string" } } },
    });
    const after = tool("echo", {
      inputSchema: { properties: { text: { type: "string" }, count: { type: "number" } }, type: "object" },
    });

    expect(audit.buildToolChangeAuditEvent("fixture", 2, [before], [after])).toBeNull();
  });

  it("records added, removed, and modified tool metadata", async () => {
    const audit = await import("./tool-change-audit");
    const event = audit.buildToolChangeAuditEvent(
      "fixture",
      3,
      [tool("removed"), tool("changed")],
      [tool("added"), tool("changed", {
        description: "updated",
        permission: "auto",
        inputSchema: { type: "object", properties: { value: { type: "boolean" } } },
      })]
    );

    expect(event).not.toBeNull();
    expect(event!.added.map((item) => item.name)).toEqual(["added"]);
    expect(event!.removed.map((item) => item.name)).toEqual(["removed"]);
    expect(event!.modified[0]).toMatchObject({
      name: "changed",
      changedFields: ["description", "inputSchema", "permission"],
    });
  });

  it("persists events and filters them by server", async () => {
    const audit = await import("./tool-change-audit");
    const first = audit.buildToolChangeAuditEvent("first", 2, [], [tool("one")])!;
    const second = audit.buildToolChangeAuditEvent("second", 2, [], [tool("two")])!;
    audit.appendToolChangeAuditEvent(first);
    audit.appendToolChangeAuditEvent(second);

    expect(audit.listToolChangeAuditEvents("first")).toEqual([first]);
    expect(audit.listToolChangeAuditEvents("second")).toEqual([second]);
  });
});
