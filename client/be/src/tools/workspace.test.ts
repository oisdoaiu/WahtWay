import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeWorkspace, resolveToolPath } from "./workspace";
import { listFilesTool } from "./file-tools";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("workspace paths", () => {
  it("resolves relative tool paths from the workspace", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "wahtway-workspace-"));
    temporaryDirectories.push(workspace);

    expect(resolveToolPath("notes/today.md", { workspace }))
      .toBe(path.join(workspace, "notes", "today.md"));
  });

  it("keeps absolute tool paths unchanged", () => {
    const absolutePath = path.resolve(os.tmpdir(), "outside.txt");
    expect(resolveToolPath(absolutePath, { workspace: path.resolve("workspace") }))
      .toBe(path.normalize(absolutePath));
  });

  it("validates that a workspace is an existing directory", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "wahtway-workspace-"));
    temporaryDirectories.push(workspace);

    expect(normalizeWorkspace(workspace)).toBe(path.resolve(workspace));
    expect(() => normalizeWorkspace(path.join(workspace, "missing"))).toThrow("工作区不存在");
  });

  it("lets file tools use the workspace as the current directory", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "wahtway-workspace-"));
    temporaryDirectories.push(workspace);
    fs.writeFileSync(path.join(workspace, "notes.txt"), "test", "utf-8");

    const result = await listFilesTool.execute({ directory: "." }, { workspace });
    expect(result).toContain("notes.txt");
  });
});
