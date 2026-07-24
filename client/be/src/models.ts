export const DEFAULT_MODEL = "deepseek-v4-flash";

export function resolveModel(model?: string | null): string {
  const candidate = model?.trim();
  return candidate || DEFAULT_MODEL;
}
