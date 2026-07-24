import { afterEach, describe, expect, it } from "vitest";
import { buildHubDownloadUrl, buildHubListUrl } from "./skills";

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
