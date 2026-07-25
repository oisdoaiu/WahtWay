import { describe, expect, it } from "vitest";
import { Skill } from "../types";
import { formatLlmError } from "../llm-errors";
import {
  evaluateSkillDependencies,
  SkillDependencyError,
  SkillDependencyServerSnapshot,
} from "./dependency-health";

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "fixture-skill",
    name: "Fixture Skill",
    description: "Dependency fixture",
    systemPrompt: "Use the configured tools.",
    input: { type: "object", properties: {} },
    output: { type: "object", properties: {} },
    requiredTools: [],
    ...overrides,
  };
}

function server(overrides: Partial<SkillDependencyServerSnapshot> = {}): SkillDependencyServerSnapshot {
  return {
    id: "files",
    name: "Files",
    enabled: true,
    status: {
      state: "running",
      lastError: null,
      tools: [{ name: "read_file", registeredName: "mcp-files-read_file", permission: "confirm" }],
    },
    ...overrides,
  };
}

const binding = {
  serverId: "files",
  toolName: "read_file",
  registeredName: "mcp-files-read_file",
};

describe("Skill dependency health", () => {
  it("keeps a Skill without tool dependencies healthy", () => {
    const health = evaluateSkillDependencies(skill(), [], [], "2026-07-25T00:00:00.000Z");

    expect(health).toMatchObject({ status: "healthy", runnable: true, checkedAt: "2026-07-25T00:00:00.000Z" });
    expect(health.issues).toEqual([]);
  });

  it("marks missing optional tools as degraded without blocking", () => {
    const health = evaluateSkillDependencies(skill({ allowedTools: ["optional-search"] }), [], []);

    expect(health).toMatchObject({ status: "degraded", runnable: true });
    expect(health.issues).toEqual([expect.objectContaining({
      code: "optional_tool_missing",
      severity: "warning",
      toolName: "optional-search",
    })]);
  });

  it("blocks a missing required tool and an inconsistent whitelist", () => {
    const health = evaluateSkillDependencies(skill({
      requiredTools: ["required-search"],
      allowedTools: ["different-tool"],
    }), [], ["different-tool"]);

    expect(health).toMatchObject({ status: "unavailable", runnable: false });
    expect(health.issues.map((issue) => issue.code)).toEqual([
      "required_tool_not_allowed",
      "required_tool_missing",
    ]);
  });

  it("accepts a running confirm-permission MCP binding", () => {
    const health = evaluateSkillDependencies(
      skill({ allowedTools: [binding.registeredName], mcpBindings: [binding] }),
      [server()],
      [binding.registeredName]
    );

    expect(health).toMatchObject({ status: "healthy", runnable: true });
    expect(health.bindings).toEqual([expect.objectContaining({
      ...binding,
      status: "healthy",
      permission: "confirm",
      issueCodes: [],
    })]);
  });

  it("blocks a healthy MCP binding that the Skill whitelist excludes", () => {
    const health = evaluateSkillDependencies(
      skill({ allowedTools: ["different-tool"], mcpBindings: [binding] }),
      [server()],
      [binding.registeredName, "different-tool"]
    );

    expect(health).toMatchObject({ status: "unavailable", runnable: false });
    expect(health.bindings[0]).toMatchObject({
      status: "unavailable",
      issueCodes: ["mcp_tool_not_allowed"],
    });
  });

  it.each([
    ["missing", [], "mcp_server_missing"],
    ["disabled", [server({ enabled: false })], "mcp_server_disabled"],
    ["stopped", [server({ status: { state: "stopped", lastError: null, tools: [] } })], "mcp_server_not_running"],
    ["reconnecting", [server({ status: { state: "reconnecting", lastError: "connection lost", tools: [] } })], "mcp_server_not_running"],
  ])("blocks a binding when its server is %s", (_label, servers, expectedCode) => {
    const health = evaluateSkillDependencies(skill({ mcpBindings: [binding] }), servers as SkillDependencyServerSnapshot[], []);

    expect(health).toMatchObject({ status: "unavailable", runnable: false });
    expect(health.issues[0]).toMatchObject({ code: expectedCode, severity: "blocking", serverId: "files" });
  });

  it("blocks a binding when the configured tool disappears", () => {
    const health = evaluateSkillDependencies(
      skill({ mcpBindings: [binding] }),
      [server({ status: { state: "running", lastError: null, tools: [] } })],
      []
    );

    expect(health.issues[0]).toMatchObject({ code: "mcp_tool_missing", toolName: "read_file" });
    expect(health.bindings[0].status).toBe("unavailable");
  });

  it("blocks a disabled MCP tool without treating confirm as disabled", () => {
    const health = evaluateSkillDependencies(
      skill({ mcpBindings: [binding] }),
      [server({ status: {
        state: "running",
        lastError: null,
        tools: [{ ...binding, name: binding.toolName, permission: "disabled" }],
      } })],
      []
    );

    expect(health.issues[0]).toMatchObject({ code: "mcp_tool_disabled" });
  });

  it("returns a rebind suggestion when the registered name changes", () => {
    const health = evaluateSkillDependencies(
      skill({ mcpBindings: [binding] }),
      [server({ status: {
        state: "running",
        lastError: null,
        tools: [{ name: "read_file", registeredName: "mcp-files-v2-read_file", permission: "auto" }],
      } })],
      ["mcp-files-v2-read_file"]
    );

    expect(health.issues[0]).toMatchObject({
      code: "mcp_registered_name_changed",
      registeredName: binding.registeredName,
      suggestedRegisteredName: "mcp-files-v2-read_file",
    });
  });

  it("blocks a runtime tool that has not reached the Agent registry", () => {
    const health = evaluateSkillDependencies(skill({ mcpBindings: [binding] }), [server()], []);

    expect(health.issues[0]).toMatchObject({ code: "mcp_tool_unregistered" });
  });

  it("exposes structured health on dependency errors", () => {
    const manifest = skill({ mcpBindings: [binding] });
    const health = evaluateSkillDependencies(manifest, [], []);
    const error = new SkillDependencyError(manifest, health);

    expect(error.code).toBe("SKILL_DEPENDENCY_UNAVAILABLE");
    expect(error.health).toBe(health);
    expect(error.message).toContain("Fixture Skill");
    expect(error.message).toContain("files");
  });

  it("keeps dependency guidance ahead of generic LLM network errors", () => {
    const manifest = skill({ mcpBindings: [binding] });
    const health = evaluateSkillDependencies(manifest, [server({
      status: { state: "reconnecting", lastError: "connection lost", tools: [] },
    })], []);
    const error = new SkillDependencyError(manifest, health);

    expect(formatLlmError(error)).toBe(error.message);
    expect(formatLlmError(error)).toContain("正在重连");
  });
});
