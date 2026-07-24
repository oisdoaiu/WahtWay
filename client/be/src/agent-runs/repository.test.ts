import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dataDir = "";
let repository: typeof import("./repository");

function checkpointInput(conversationId: string, expiresAt?: string) {
  return {
    conversationId,
    traceId: "trace-test",
    systemPrompt: "test",
    messages: [{ role: "user", content: "hello" }],
    round: 0,
    totalRoundTokens: 0,
    toolCallCount: 1,
    startedAt: new Date().toISOString(),
    currentBatch: {
      calls: [{ id: "call-1", name: "write-file", argumentsJson: "{}" }],
      nextIndex: 0,
    },
    pendingApproval: {
      toolCallId: "call-1",
      toolName: "write-file",
      arguments: {},
      kind: "file" as const,
      reason: "confirm",
    },
    expiresAt,
  };
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wahtway-agent-runs-test-"));
  process.env.WAHTWAY_DATA_DIR = dataDir;
  repository = await import("./repository");
});

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.WAHTWAY_DATA_DIR;
});

describe("agent run repository", () => {
  it("lists pending approvals only for their conversation", () => {
    const run = repository.createAgentRunCheckpoint(checkpointInput("conversation-a"));
    repository.createAgentRunCheckpoint(checkpointInput("conversation-b"));

    expect(repository.listPendingAgentRuns("conversation-a").map((item) => item.id)).toEqual([run.id]);
  });

  it("rejects cross-conversation and duplicate claims", () => {
    const run = repository.createAgentRunCheckpoint(checkpointInput("conversation-c"));

    expect(() => repository.claimAgentRun(run.id, "conversation-other"))
      .toThrow(repository.AgentRunConversationMismatchError);
    expect(repository.claimAgentRun(run.id, "conversation-c").status).toBe("resuming");
    expect(() => repository.claimAgentRun(run.id, "conversation-c"))
      .toThrow(repository.AgentRunConflictError);
  });

  it("expires stale approvals before they can be claimed", () => {
    const run = repository.createAgentRunCheckpoint(
      checkpointInput("conversation-expired", new Date(Date.now() - 1000).toISOString())
    );

    expect(() => repository.claimAgentRun(run.id, "conversation-expired"))
      .toThrow(repository.AgentRunExpiredError);
    expect(repository.listPendingAgentRuns("conversation-expired")).toEqual([]);
  });
});
