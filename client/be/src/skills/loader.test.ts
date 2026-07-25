import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Skill } from "../types";

const learningMocks = vi.hoisted(() => ({
  deleteSkillLearning: vi.fn(),
  getActiveSkillOverride: vi.fn(() => null),
  resetActiveSkillVersion: vi.fn(),
}));

vi.mock("./learning-store", () => learningMocks);

import { readPersistedSkill, saveSkill } from "./loader";

let workspace = "";

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "atomic-skill",
    name: "Atomic skill",
    description: "Loader fixture",
    systemPrompt: "Fixture prompt",
    input: { type: "object", properties: {} },
    output: { type: "object", properties: {} },
    requiredTools: [],
    version: 4,
    origin: "learned",
    ...overrides,
  };
}

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "wahtway-skill-loader-test-"));
  fs.mkdirSync(path.join(workspace, "data", "skills"), { recursive: true });
  vi.spyOn(process, "cwd").mockReturnValue(workspace);
  learningMocks.deleteSkillLearning.mockClear();
  learningMocks.getActiveSkillOverride.mockClear();
  learningMocks.resetActiveSkillVersion.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe("Skill loader persistence", () => {
  it.each(["../escape", "nested/escape", "..\\escape", ".hidden"])(
    "rejects an unsafe Skill ID: %s",
    (skillId) => {
      expect(() => readPersistedSkill(skillId)).toThrow("Skill ID");
      expect(() => saveSkill(skill({ id: skillId }))).toThrow("Skill ID");
    }
  );

  it("atomically saves a manifest that can be read back", () => {
    const manifest = skill({ allowedTools: ["local-tool"] });

    saveSkill(manifest);

    expect(readPersistedSkill(manifest.id)).toEqual({
      ...manifest,
      version: undefined,
      origin: undefined,
    });
    const files = fs.readdirSync(path.join(workspace, "data", "skills"));
    expect(files).toEqual([`${manifest.id}.json`]);
    expect(files.some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("does not reset learned state when resetLearning is false", () => {
    saveSkill(skill(), { resetLearning: false });

    expect(learningMocks.resetActiveSkillVersion).not.toHaveBeenCalled();
  });
});
