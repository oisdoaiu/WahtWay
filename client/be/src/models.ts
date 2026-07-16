export const DEFAULT_MODEL = "deepseek-v4-flash";

export const SUPPORTED_MODELS = new Set([
  DEFAULT_MODEL,
  "deepseek-v4-pro",
]);

export function resolveModel(model?: string | null): string {
  const candidate = model?.trim();
  return candidate && SUPPORTED_MODELS.has(candidate) ? candidate : DEFAULT_MODEL;
}
