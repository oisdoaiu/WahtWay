import { afterEach, describe, expect, it } from "vitest";
import { buildHubDownloadUrl, buildHubListUrl, buildSkillToolCatalog } from "./skills";
import { registerTool, unregisterTool } from "../tools/registry";

const originalHubUrl = process.env.SKILL_HUB_URL;

afterEach(() => {
  if (originalHubUrl === undefined) delete process.env.SKILL_HUB_URL;
  else process.env.SKILL_HUB_URL = originalHubUrl;
});

describe("Skill Hub URLs", () => {
  it("forwards supported list filters", () => {
    process.env.SKILL_HUB_URL = "https://hub.example.com/";
    const url = buildHubListUrl({ q: "ppt", sort: "rating", ignored: "value" } as any);

    expect(url).toBe("https://hub.example.com/api/skills?q=ppt&sort=rating");
  });

  it("encodes skill ids in download URLs", () => {
    process.env.SKILL_HUB_URL = "https://hub.example.com";
    expect(buildHubDownloadUrl("report helper"))
      .toBe("https://hub.example.com/api/skills/report%20helper/download");
  });
});

describe("Skill tool catalog", () => {
  it("classifies registered builtin tools conservatively", () => {
    registerTool({
      name: "catalog-read-fixture", description: "Reads fixture data",
      parameters: { type: "object", properties: {} }, execute: async () => "ok",
    });
    registerTool({
      name: "catalog-delete-fixture", description: "Deletes fixture data",
      parameters: { type: "object", properties: {} }, execute: async () => "ok",
    });
    try {
      const catalog = buildSkillToolCatalog();
      expect(catalog.find((tool) => tool.name === "catalog-read-fixture")).toMatchObject({
        source: "builtin", risk: "read", permission: "auto", available: true,
      });
      expect(catalog.find((tool) => tool.name === "catalog-delete-fixture")).toMatchObject({
        source: "builtin", risk: "destructive", permission: "confirm", available: true,
      });
    } finally {
      unregisterTool("catalog-read-fixture");
      unregisterTool("catalog-delete-fixture");
    }
  });
});
