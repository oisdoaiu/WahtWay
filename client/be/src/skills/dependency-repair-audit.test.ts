import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateSkillDependencyRepairAuditEventInput } from "./dependency-repair-audit";

let dataDir = "";

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wahtway-dependency-repair-audit-test-"));
  process.env.WAHTWAY_DATA_DIR = dataDir;
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.WAHTWAY_DATA_DIR;
  vi.resetModules();
});

function input(skillId = "research-helper"): CreateSkillDependencyRepairAuditEventInput {
  return {
    skillId,
    bindingIndex: 0,
    beforeRevision: "before-revision",
    afterRevision: "after-revision",
    beforeBinding: {
      serverId: "old-server",
      toolName: "old-tool",
      registeredName: "mcp-old-server-old-tool",
    },
    afterBinding: {
      serverId: "new-server",
      toolName: "new-tool",
      registeredName: "mcp-new-server-new-tool",
    },
    changedFields: ["mcpBindings", "allowedTools", "systemPrompt"],
    promptPolicy: "replace-exact",
    promptReplacementCount: 2,
    warnings: ["Tool permission requires confirmation"],
  };
}

function auditPath(): string {
  return path.join(dataDir, "skill-learning", "dependency-repairs", "audit.json");
}

describe("Skill dependency repair audit", () => {
  it("creates and persists the minimum repair event", async () => {
    const audit = await import("./dependency-repair-audit");
    const event = audit.createSkillDependencyRepairAuditEvent(input());

    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(event.createdAt)).not.toBeNaN();
    expect(event).toMatchObject(input());

    audit.appendSkillDependencyRepairAuditEvent(event);
    expect(audit.listSkillDependencyRepairAuditEvents("research-helper")).toEqual([event]);
  });

  it("whitelists persisted fields and never stores prompts or server configuration", async () => {
    const audit = await import("./dependency-repair-audit");
    const event = audit.createSkillDependencyRepairAuditEvent(input()) as unknown as Record<string, unknown>;
    event.systemPrompt = "DO NOT PERSIST THIS PROMPT";
    event.serverConfig = { command: "secret-command", env: { TOKEN: "secret-token" } };
    (event.beforeBinding as Record<string, unknown>).env = { TOKEN: "nested-secret-token" };

    audit.appendSkillDependencyRepairAuditEvent(event as never);

    const raw = fs.readFileSync(auditPath(), "utf-8");
    expect(raw).not.toContain("DO NOT PERSIST THIS PROMPT");
    expect(raw).not.toContain("secret-command");
    expect(raw).not.toContain("secret-token");
    expect(Object.keys(JSON.parse(raw).events[0])).toEqual([
      "id",
      "skillId",
      "createdAt",
      "bindingIndex",
      "beforeRevision",
      "afterRevision",
      "beforeBinding",
      "afterBinding",
      "changedFields",
      "promptPolicy",
      "promptReplacementCount",
      "warnings",
    ]);
  });

  it("filters by skill, applies the limit, and returns defensive copies", async () => {
    const audit = await import("./dependency-repair-audit");
    const first = {
      ...audit.createSkillDependencyRepairAuditEvent(input("first")),
      createdAt: "2026-07-25T01:00:00.000Z",
    };
    const newest = {
      ...audit.createSkillDependencyRepairAuditEvent(input("first")),
      createdAt: "2026-07-25T03:00:00.000Z",
    };
    const other = {
      ...audit.createSkillDependencyRepairAuditEvent(input("other")),
      createdAt: "2026-07-25T02:00:00.000Z",
    };
    audit.appendSkillDependencyRepairAuditEvent(first);
    audit.appendSkillDependencyRepairAuditEvent(newest);
    audit.appendSkillDependencyRepairAuditEvent(other);

    const listed = audit.listSkillDependencyRepairAuditEvents("first", 1);
    expect(listed).toEqual([newest]);
    listed[0].warnings.push("mutated");
    expect(audit.listSkillDependencyRepairAuditEvents("first", 1)[0].warnings).toEqual(newest.warnings);
    expect(audit.listSkillDependencyRepairAuditEvents(undefined, 10).map((event) => event.skillId))
      .toEqual(["first", "other", "first"]);
  });

  it("retains only the newest 500 events", async () => {
    const audit = await import("./dependency-repair-audit");
    const events = Array.from({ length: 500 }, (_, index) => ({
      ...audit.createSkillDependencyRepairAuditEvent(input("bulk")),
      id: `event-${index}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    }));
    fs.mkdirSync(path.dirname(auditPath()), { recursive: true });
    fs.writeFileSync(auditPath(), JSON.stringify({ schemaVersion: 1, events }), "utf-8");

    const latest = {
      ...audit.createSkillDependencyRepairAuditEvent(input("bulk")),
      id: "event-500",
      createdAt: "2026-07-26T00:00:00.000Z",
    };
    audit.appendSkillDependencyRepairAuditEvent(latest);

    const rawEvents = JSON.parse(fs.readFileSync(auditPath(), "utf-8")).events;
    expect(rawEvents).toHaveLength(500);
    expect(rawEvents[0].id).toBe("event-1");
    expect(rawEvents.at(-1).id).toBe("event-500");
  });

  it("uses a same-directory atomic file and restrictive permissions", async () => {
    const audit = await import("./dependency-repair-audit");
    audit.appendSkillDependencyRepairAuditEvent(audit.createSkillDependencyRepairAuditEvent(input()));

    expect(fs.readdirSync(path.dirname(auditPath()))).toEqual(["audit.json"]);
    if (process.platform !== "win32") {
      expect(fs.statSync(auditPath()).mode & 0o777).toBe(0o600);
    }
  });

  it("rejects an individual event that would exceed the file size limit", async () => {
    const audit = await import("./dependency-repair-audit");
    const event = audit.createSkillDependencyRepairAuditEvent({
      ...input(),
      warnings: ["x".repeat(5 * 1024 * 1024)],
    });

    expect(() => audit.appendSkillDependencyRepairAuditEvent(event)).toThrow("exceeds the size limit");
    expect(fs.existsSync(auditPath())).toBe(false);
    const repairDir = path.dirname(auditPath());
    expect(fs.existsSync(repairDir) ? fs.readdirSync(repairDir) : []).toEqual([]);
  });
});
