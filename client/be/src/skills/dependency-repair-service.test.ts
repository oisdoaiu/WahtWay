import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicMcpServer } from "../mcp/types";
import type { McpSkillBinding, Skill } from "../types";

const serviceMocks = vi.hoisted(() => ({
  listPublicMcpServers: vi.fn(),
  getAllTools: vi.fn(),
  getSkillDependencyHealth: vi.fn(),
  createAuditEvent: vi.fn(),
  appendAuditEvent: vi.fn(),
  readPersistedSkill: vi.fn(),
  saveSkill: vi.fn(),
  readLearningState: vi.fn(),
}));

vi.mock("../mcp/runtime", () => ({
  listPublicMcpServers: serviceMocks.listPublicMcpServers,
}));

vi.mock("../tools/registry", () => ({
  getAllTools: serviceMocks.getAllTools,
}));

vi.mock("./dependency-health", () => ({
  getSkillDependencyHealth: serviceMocks.getSkillDependencyHealth,
}));

vi.mock("./dependency-repair-audit", () => ({
  createSkillDependencyRepairAuditEvent: serviceMocks.createAuditEvent,
  appendSkillDependencyRepairAuditEvent: serviceMocks.appendAuditEvent,
}));

vi.mock("./loader", () => ({
  readPersistedSkill: serviceMocks.readPersistedSkill,
  saveSkill: serviceMocks.saveSkill,
}));

vi.mock("./learning-store", () => ({
  readLearningState: serviceMocks.readLearningState,
}));

import {
  applySkillBindingRepair,
  previewSkillBindingRepair,
  skillDependencyRevision,
  SkillDependencyRepairError,
  type SkillBindingRepairRequest,
} from "./dependency-repair";

const originalBinding: McpSkillBinding = {
  serverId: "files-v1",
  toolName: "read_file",
  registeredName: "mcp-files-v1-read-file",
};

const replacementBinding: McpSkillBinding = {
  serverId: "files-v2",
  toolName: "read_file_v2",
  registeredName: "mcp-files-v2-read-file-v2",
};

const toolListRevision = 12;

function fixtureSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "repair-service-fixture",
    name: "Repair service fixture",
    description: "Dependency repair service fixture",
    systemPrompt: `Use ${originalBinding.registeredName} when needed.`,
    input: { type: "object", properties: {} },
    output: { type: "object", properties: {} },
    requiredTools: [originalBinding.registeredName],
    allowedTools: [originalBinding.registeredName],
    mcpBindings: [originalBinding],
    ...overrides,
  };
}

function replacementServer(overrides: Partial<PublicMcpServer> = {}): PublicMcpServer {
  return {
    id: replacementBinding.serverId,
    name: "Files v2",
    description: "Replacement MCP server",
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
      tools: [{
        name: replacementBinding.toolName,
        registeredName: replacementBinding.registeredName,
        description: "Read a file",
        inputSchema: { type: "object" },
        permission: "confirm",
        annotations: {},
        risk: "read",
        riskSource: "default",
        idempotent: false,
      }],
      startedAt: "2026-07-26T00:00:00.000Z",
      lastError: null,
      lastHealthCheckAt: "2026-07-26T00:00:00.000Z",
      lastDisconnectedAt: null,
      consecutiveFailures: 0,
      reconnectAttempt: 0,
      nextReconnectAt: null,
      toolListRevision,
      lastToolListChangedAt: null,
      lastToolListError: null,
    },
    ...overrides,
  };
}

function repairRequest(
  manifest: Skill,
  overrides: Partial<SkillBindingRepairRequest> = {}
): SkillBindingRepairRequest {
  return {
    expectedRevision: skillDependencyRevision(manifest),
    expectedBinding: originalBinding,
    replacement: {
      serverId: replacementBinding.serverId,
      toolName: replacementBinding.toolName,
    },
    expectedToolListRevision: toolListRevision,
    promptPolicy: "replace-exact",
    ...overrides,
  };
}

function expectConflict(action: () => unknown, code: string): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(SkillDependencyRepairError);
  expect(caught).toMatchObject({ code, status: 409 });
}

beforeEach(() => {
  vi.clearAllMocks();
  const manifest = fixtureSkill();
  serviceMocks.readPersistedSkill.mockReturnValue(manifest);
  serviceMocks.readLearningState.mockReturnValue({ activeVersion: 1 });
  serviceMocks.listPublicMcpServers.mockReturnValue([replacementServer()]);
  serviceMocks.getAllTools.mockReturnValue([{ name: replacementBinding.registeredName }]);
  serviceMocks.getSkillDependencyHealth.mockReturnValue({
    status: "healthy",
    runnable: true,
    issues: [],
    bindings: [],
  });
  serviceMocks.createAuditEvent.mockImplementation((input) => ({
    ...input,
    id: "audit-event-1",
    createdAt: "2026-07-26T00:00:00.000Z",
  }));
});

describe("Skill dependency repair service consistency", () => {
  it.each([
    ["preview", previewSkillBindingRepair],
    ["apply", applySkillBindingRepair],
  ])("rejects a stale expectedRevision during %s", (_operation, operation) => {
    const manifest = fixtureSkill();
    const request = repairRequest(manifest, { expectedRevision: "0".repeat(64) });

    expectConflict(() => operation(manifest.id, 0, request), "SKILL_REVISION_CHANGED");
    expect(serviceMocks.saveSkill).not.toHaveBeenCalled();
  });

  it("rejects when the binding changed after the caller read it", () => {
    const manifest = fixtureSkill();
    const request = repairRequest(manifest, {
      expectedBinding: {
        ...originalBinding,
        registeredName: "mcp-files-v1-renamed",
      },
    });

    expectConflict(
      () => previewSkillBindingRepair(manifest.id, 0, request),
      "BINDING_CHANGED"
    );
  });

  it("rejects when the target tool list revision changed", () => {
    const manifest = fixtureSkill();
    const request = repairRequest(manifest, {
      expectedToolListRevision: toolListRevision - 1,
    });

    expectConflict(
      () => previewSkillBindingRepair(manifest.id, 0, request),
      "TOOL_LIST_CHANGED"
    );
  });

  it("revalidates the candidate and rejects it when unavailable before apply", () => {
    const manifest = fixtureSkill();
    const request = repairRequest(manifest);

    expect(previewSkillBindingRepair(manifest.id, 0, request).replacementBinding)
      .toEqual(replacementBinding);
    serviceMocks.listPublicMcpServers.mockReturnValue([]);

    expectConflict(
      () => applySkillBindingRepair(manifest.id, 0, request),
      "REPLACEMENT_UNAVAILABLE"
    );
    expect(serviceMocks.saveSkill).not.toHaveBeenCalled();
  });

  it("rejects repair while a learned Skill version is active", () => {
    const manifest = fixtureSkill();
    serviceMocks.readLearningState.mockReturnValue({ activeVersion: 2 });

    expectConflict(
      () => previewSkillBindingRepair(manifest.id, 0, repairRequest(manifest)),
      "ACTIVE_LEARNED_VERSION"
    );
  });

  it("applies atomically without resetting learning and records the audit", () => {
    const manifest = fixtureSkill();

    const result = applySkillBindingRepair(manifest.id, 0, repairRequest(manifest));

    expect(serviceMocks.saveSkill).toHaveBeenCalledOnce();
    expect(serviceMocks.saveSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        id: manifest.id,
        mcpBindings: [replacementBinding],
        allowedTools: [replacementBinding.registeredName],
        requiredTools: [replacementBinding.registeredName],
      }),
      { resetLearning: false }
    );
    expect(serviceMocks.createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      skillId: manifest.id,
      bindingIndex: 0,
      beforeBinding: originalBinding,
      afterBinding: replacementBinding,
      changedFields: ["mcpBindings", "allowedTools", "requiredTools", "systemPrompt"],
      promptPolicy: "replace-exact",
      promptReplacementCount: 1,
    }));
    expect(serviceMocks.appendAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      id: "audit-event-1",
    }));
    expect(result).toMatchObject({
      auditRecorded: true,
      auditEvent: { id: "audit-event-1" },
      dependencyHealth: { status: "healthy", runnable: true },
    });
    expect(result.beforeRevision).toBe(skillDependencyRevision(manifest));
    expect(result.afterRevision).not.toBe(result.beforeRevision);
  });

  it("keeps the applied manifest when audit persistence fails", () => {
    const manifest = fixtureSkill();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    serviceMocks.appendAuditEvent.mockImplementationOnce(() => {
      throw new Error("audit disk full");
    });

    const result = applySkillBindingRepair(manifest.id, 0, repairRequest(manifest));

    expect(serviceMocks.saveSkill).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      auditRecorded: false,
      auditWarning: "audit disk full",
    });
    expect(result.auditEvent).toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
