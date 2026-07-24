type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export async function fetchAvailableModels(
  baseURL: string,
  apiKey: string,
  fetcher: FetchLike = fetch
): Promise<string[]> {
  const normalizedBaseURL = baseURL.trim().replace(/\/+$/, "") + "/";
  const url = new URL("models", normalizedBaseURL);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as any;
    if (!response.ok) {
      throw new Error(payload?.error?.message || payload?.message || `模型接口返回 HTTP ${response.status}`);
    }
    const items = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : [];
    const models = items
      .map((item: any) => typeof item === "string" ? item : item?.id)
      .filter((item: unknown): item is string => typeof item === "string" && !!item.trim())
      .map((item: string) => item.trim());
    return Array.from(new Set(models)).sort((left, right) => left.localeCompare(right));
  } finally {
    clearTimeout(timeout);
  }
}
