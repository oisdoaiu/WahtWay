const LLM_TIMEOUT_MESSAGE = "LLM 响应超时了，可能是网络不稳定或模型服务暂时繁忙。请稍后重试，或检查 API Key、代理/网络连接。";
const LLM_NETWORK_MESSAGE = "连接 LLM 服务失败，请检查网络、代理设置或当前 API 服务状态后重试。";
const LLM_AUTH_MESSAGE = "LLM 鉴权失败，请检查 AI 配置里的 API Key 是否正确。";
const LLM_RATE_LIMIT_MESSAGE = "LLM 请求过于频繁或额度受限，请稍后再试。";

export function formatLlmError(err: unknown): string {
  const anyErr = err as any;
  const rawMessage = String(anyErr?.message || anyErr || "").trim();
  const message = rawMessage.toLowerCase();
  const code = String(anyErr?.code || anyErr?.type || "").toLowerCase();
  const status = Number(anyErr?.status || anyErr?.statusCode || 0);

  if (status === 401 || status === 403 || message.includes("unauthorized") || message.includes("invalid api key")) {
    return LLM_AUTH_MESSAGE;
  }

  if (status === 429 || message.includes("rate limit") || message.includes("too many requests")) {
    return LLM_RATE_LIMIT_MESSAGE;
  }

  if (
    status === 408 ||
    status === 504 ||
    code.includes("timeout") ||
    code === "etimedout" ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("request timed out")
  ) {
    return LLM_TIMEOUT_MESSAGE;
  }

  if (
    code === "econnreset" ||
    code === "enotfound" ||
    code === "eai_again" ||
    code === "econrefused" ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("socket") ||
    message.includes("connection")
  ) {
    return LLM_NETWORK_MESSAGE;
  }

  return rawMessage || "LLM 请求失败，请稍后重试。";
}
