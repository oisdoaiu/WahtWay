import { describe, expect, it, vi } from "vitest";
import { fetchAvailableModels } from "./ai-models";

describe("fetchAvailableModels", () => {
  it("loads and sorts OpenAI-compatible model ids", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "model-b" }, { id: "model-a" }, { id: "model-a" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(fetchAvailableModels("https://example.com/v1", "secret", fetcher))
      .resolves.toEqual(["model-a", "model-b"]);
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://example.com/v1/models"),
      expect.objectContaining({ headers: { Authorization: "Bearer secret" } })
    );
  });

  it("returns provider errors without exposing the key", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      error: { message: "invalid credentials" },
    }), { status: 401, headers: { "Content-Type": "application/json" } }));

    await expect(fetchAvailableModels("https://example.com/v1", "top-secret", fetcher))
      .rejects.toThrow("invalid credentials");
  });
});
