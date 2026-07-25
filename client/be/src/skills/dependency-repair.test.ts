import { describe, expect, it } from "vitest";
import type { PublicMcpServer, McpToolRisk } from "../mcp/types";
import type { Skill } from "../types";
import {
  buildSkillBindingRepair,
  buildSkillRepairCandidates,
  SkillDependencyRepairError,
  type SkillRepairCandidate,
  skillDependencyRevision,
} from "./dependency-repair";

const originalBinding = {
  serverId: "files",
  toolName: "read_file",
  registeredName: "mcp-files-read_file",
};

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "repair-fixture",
    name: "Repair fixture",
    description: "Dependency repair fixture",
    systemPrompt: `Call ${originalBinding.registeredName} when needed.`,
    input: { type: "object", properties: {} },
    output: { type: "object", properties: {} },
    requiredTools: [originalBinding.registeredName],
    allowedTools: [originalBinding.registeredName],
    mcpBindings: [originalBinding],
    ...overrides,
  };
}

function server(
  id: string,
  tools: Array<{
    name: string;
    registeredName: string;
    risk?: McpToolRisk;
    permission?: "auto" | "confirm" | "disabled";
  }>,
  overrides: Partial<PublicMcpServer> = {}
): PublicMcpServer {
  return {
    id,
    name: id,
    description: "Fixture MCP server",
    command: "fixture",
    args: [],
    cwd: null,
    env: {},
    enabled: true,
    autoStart: false,
    defaultToolPermission: "confirm",
    toolPermissions: {},
    toolSafetyOverrides: {},
    toolCallTimeoutMs: 30_000,
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
    schemaVersion: 3,
    secretNames: [],
    status: {
      state: "running",
      tools: tools.map((tool) => ({
        name: tool.name,
        registeredName: tool.registeredName,
        description: tool.name,
        inputSchema: { type: "object" },
        permission: tool.permission ?? "confirm",
        annotations: {},
        risk: tool.risk ?? "read",
        riskSource: "default",
        idempotent: false,
      })),
      startedAt: "2026-07-26T00:00:00.000Z",
      lastError: null,
      lastHealthCheckAt: "2026-07-26T00:00:00.000Z",
      lastDisconnectedAt: null,
      consecutiveFailures: 0,
      reconnectAttempt: 0,
      nextReconnectAt: null,
      toolListRevision: 7,
      lastToolListChangedAt: null,
      lastToolListError: null,
    },
    ...overrides,
  };
}

function candidate(overrides: Partial<SkillRepairCandidate> = {}): SkillRepairCandidate {
  return {
    serverId: "files-v2",
    serverName: "Files v2",
    toolName: "read_file_v2",
    registeredName: "mcp-files-v2-read_file-v2",
    description: "Read a file",
    permission: "confirm",
    risk: "read",
    match: "other",
    recommended: false,
    toolListRevision: 8,
    schemaCompatibility: "unknown",
    ...overrides,
  };
}

describe("Skill dependency repair", () => {
  it("filters unavailable tools and sorts candidates by match then risk", () => {
    const manifest = skill({
      mcpBindings: [
        originalBinding,
        { serverId: "used", toolName: "duplicate", registeredName: "mcp-used-duplicate" },
      ],
    });
    const servers = [
      server("files", [
        { name: "read_file", registeredName: "mcp-files-read_file-v2", risk: "write" },
        { name: "list_files", registeredName: "mcp-files-list_files", risk: "read" },
        { name: "disabled", registeredName: "mcp-files-disabled", permission: "disabled" },
        { name: "not_registered", registeredName: "mcp-files-not_registered" },
      ]),
      server("same-tool", [
        { name: "read_file", registeredName: "mcp-same-tool-read_file", risk: "destructive" },
      ]),
      server("other", [
        { name: "search", registeredName: "mcp-other-search", risk: "read" },
        { name: "write", registeredName: "mcp-other-write", risk: "write" },
      ]),
      server("used", [
        { name: "duplicate", registeredName: "mcp-used-duplicate" },
      ]),
      server("disabled-server", [
        { name: "read_file", registeredName: "mcp-disabled-read_file" },
      ], { enabled: false }),
      server("stopped-server", [
        { name: "read_file", registeredName: "mcp-stopped-read_file" },
      ], { status: { ...server("ignored", []).status, state: "stopped" } }),
    ];
    const registry = [
      "mcp-files-read_file-v2",
      "mcp-files-list_files",
      "mcp-files-disabled",
      "mcp-same-tool-read_file",
      "mcp-other-search",
      "mcp-other-write",
      "mcp-used-duplicate",
      "mcp-disabled-read_file",
      "mcp-stopped-read_file",
    ];

    const result = buildSkillRepairCandidates(manifest, 0, servers, registry);

    expect(result.map((item) => [item.registeredName, item.match])).toEqual([
      ["mcp-files-read_file-v2", "same-binding"],
      ["mcp-same-tool-read_file", "same-tool"],
      ["mcp-files-list_files", "same-server"],
      ["mcp-other-search", "other"],
      ["mcp-other-write", "other"],
    ]);
    expect(result[0]).toMatchObject({ recommended: true, toolListRevision: 7 });
  });

  it("offers the unchanged binding when only the non-empty whitelist is broken", () => {
    const manifest = skill({ allowedTools: ["some-other-tool"] });
    const currentServer = server("files", [
      { name: "read_file", registeredName: originalBinding.registeredName },
    ]);

    const candidates = buildSkillRepairCandidates(
      manifest,
      0,
      [currentServer],
      [originalBinding.registeredName]
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        serverId: originalBinding.serverId,
        toolName: originalBinding.toolName,
        registeredName: originalBinding.registeredName,
        match: "same-binding",
        recommended: true,
      }),
    ]);
    expect(buildSkillBindingRepair(manifest, 0, candidates[0], "preserve").nextSkill.allowedTools)
      .toEqual(["some-other-tool", originalBinding.registeredName]);
  });

  it("updates allowedTools and requiredTools with the replacement registered name", () => {
    const replacement = candidate();
    const repair = buildSkillBindingRepair(
      skill({
        allowedTools: [originalBinding.registeredName, "local-tool"],
        requiredTools: ["local-tool", originalBinding.registeredName],
      }),
      0,
      replacement,
      "preserve"
    );

    expect(repair.nextSkill.allowedTools).toEqual([replacement.registeredName, "local-tool"]);
    expect(repair.nextSkill.requiredTools).toEqual(["local-tool", replacement.registeredName]);
    expect(repair.changes.map((change) => change.field)).toEqual([
      "mcpBindings",
      "allowedTools",
      "requiredTools",
    ]);
  });

  it("keeps the old registered name when another binding still uses it", () => {
    const replacement = candidate();
    const manifest = skill({
      systemPrompt: `Use ${originalBinding.registeredName}.`,
      mcpBindings: [
        originalBinding,
        { serverId: "mirror", toolName: "read_file", registeredName: originalBinding.registeredName },
      ],
    });

    const repair = buildSkillBindingRepair(manifest, 0, replacement, "replace-exact");

    expect(repair.nextSkill.allowedTools).toEqual([originalBinding.registeredName, replacement.registeredName]);
    expect(repair.nextSkill.requiredTools).toEqual([originalBinding.registeredName, replacement.registeredName]);
    expect(repair.nextSkill.systemPrompt).toBe(manifest.systemPrompt);
    expect(repair.promptReplacementCount).toBe(0);
  });

  it("preserves the prompt when requested", () => {
    const manifest = skill({ systemPrompt: `Always call ${originalBinding.registeredName}.` });
    const repair = buildSkillBindingRepair(manifest, 0, candidate(), "preserve");

    expect(repair.nextSkill.systemPrompt).toBe(manifest.systemPrompt);
    expect(repair.promptReplacementCount).toBe(0);
    expect(repair.changes.map((change) => change.field)).not.toContain("systemPrompt");
  });

  it("replaces only standalone prompt references under replace-exact", () => {
    const oldName = originalBinding.registeredName;
    const replacement = candidate();
    const manifest = skill({
      systemPrompt: `${oldName}, ${oldName}-extended, prefix${oldName}, (${oldName}).`,
    });

    const repair = buildSkillBindingRepair(manifest, 0, replacement, "replace-exact");

    expect(repair.nextSkill.systemPrompt).toBe(
      `${replacement.registeredName}, ${oldName}-extended, prefix${oldName}, (${replacement.registeredName}).`
    );
    expect(repair.promptReplacementCount).toBe(2);
  });

  it("rejects a replacement that duplicates another binding", () => {
    const manifest = skill({
      mcpBindings: [
        originalBinding,
        { serverId: "files-v2", toolName: "read_file_v2", registeredName: "existing-name" },
      ],
    });

    expect(() => buildSkillBindingRepair(manifest, 0, candidate(), "preserve"))
      .toThrowError(expect.objectContaining<Partial<SkillDependencyRepairError>>({ code: "DUPLICATE_BINDING" }));
  });

  it("produces a stable revision and ignores runtime version and origin", () => {
    const first = skill({ version: 1, origin: "builtin" });
    const reordered: Skill = {
      output: first.output,
      input: first.input,
      requiredTools: first.requiredTools,
      mcpBindings: first.mcpBindings,
      allowedTools: first.allowedTools,
      systemPrompt: first.systemPrompt,
      description: first.description,
      name: first.name,
      id: first.id,
      version: 9,
      origin: "learned",
    };

    expect(skillDependencyRevision(reordered)).toBe(skillDependencyRevision(first));
    expect(skillDependencyRevision({ ...first, systemPrompt: "Changed" }))
      .not.toBe(skillDependencyRevision(first));
  });
});
