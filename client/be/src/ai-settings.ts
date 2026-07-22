import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { getRuntimeDataDir } from "./runtime-data";

export type AiProviderKind = "deepseek" | "openai-compatible";

export interface AiSettings {
  provider: AiProviderKind;
  apiKey: string;
  baseURL: string;
  model: string;
  modelOptions: string[];
  balancePath: string;
}

export interface AiSettingsPublic extends Omit<AiSettings, "apiKey"> {
  apiKeyConfigured: boolean;
}

const SETTINGS_PATH = path.join(getRuntimeDataDir(), "ai-settings.json");

const DEFAULT_SETTINGS: Record<AiProviderKind, AiSettings> = {
  deepseek: {
    provider: "deepseek",
    apiKey: "",
    baseURL: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    modelOptions: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat"],
    balancePath: "/user/balance",
  },
  "openai-compatible": {
    provider: "openai-compatible",
    apiKey: "",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    modelOptions: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1"],
    balancePath: "",
  },
};

let cachedSettings: AiSettings | null = null;

function ensureDir(): void {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
}

function atomicWriteJson(filePath: string, value: unknown): void {
  ensureDir();
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(tempPath, filePath);
}

function cloneDefault(provider: AiProviderKind): AiSettings {
  return { ...DEFAULT_SETTINGS[provider], modelOptions: [...DEFAULT_SETTINGS[provider].modelOptions] };
}

function normalizeModelOptions(value: unknown, provider: AiProviderKind): string[] {
  if (!Array.isArray(value)) return cloneDefault(provider).modelOptions;
  const options = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return options.length > 0 ? Array.from(new Set(options)).slice(0, 20) : cloneDefault(provider).modelOptions;
}

function inferProvider(baseURL: string): AiProviderKind {
  return /deepseek/i.test(baseURL) ? "deepseek" : "openai-compatible";
}

function normalizeSettings(input: Partial<AiSettings> & { provider?: AiProviderKind }): AiSettings {
  const currentProvider = input.provider || "deepseek";
  const defaults = cloneDefault(currentProvider);
  const provider = currentProvider;
  const baseURL = typeof input.baseURL === "string" && input.baseURL.trim()
    ? input.baseURL.trim().replace(/\/+$/, "")
    : defaults.baseURL;
  const model = typeof input.model === "string" && input.model.trim()
    ? input.model.trim()
    : defaults.model;
  const balancePath = typeof input.balancePath === "string"
    ? input.balancePath.trim()
    : defaults.balancePath;
  return {
    provider,
    apiKey: typeof input.apiKey === "string" ? input.apiKey.trim() : defaults.apiKey,
    baseURL,
    model,
    modelOptions: normalizeModelOptions(input.modelOptions, provider),
    balancePath,
  };
}

function envToSettings(): AiSettings {
  const baseURL = (process.env.DEEPSEEK_BASE_URL || DEFAULT_SETTINGS.deepseek.baseURL).replace(/\/+$/, "");
  const provider = inferProvider(baseURL);
  const defaults = cloneDefault(provider);
  return {
    provider,
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    baseURL,
    model: process.env.DEEPSEEK_MODEL || defaults.model,
    modelOptions: defaults.modelOptions,
    balancePath: provider === "deepseek" ? DEFAULT_SETTINGS.deepseek.balancePath : "",
  };
}

function readFromDisk(): AiSettings | null {
  if (!fs.existsSync(SETTINGS_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8")) as Partial<AiSettings> & { provider?: AiProviderKind };
    return normalizeSettings(raw);
  } catch {
    return null;
  }
}

function applyToEnv(settings: AiSettings): void {
  process.env.DEEPSEEK_API_KEY = settings.apiKey;
  process.env.DEEPSEEK_BASE_URL = settings.baseURL;
  process.env.DEEPSEEK_MODEL = settings.model;
}

export function loadAiSettings(): AiSettings {
  if (cachedSettings) return cachedSettings;
  cachedSettings = readFromDisk() || envToSettings();
  applyToEnv(cachedSettings);
  return cachedSettings;
}

export function getAiSettings(): AiSettings {
  return loadAiSettings();
}

export function getPublicAiSettings(): AiSettingsPublic {
  const settings = getAiSettings();
  const { apiKey, ...rest } = settings;
  return { ...rest, apiKeyConfigured: !!apiKey };
}

export function isAiConfigured(): boolean {
  return !!getAiSettings().apiKey;
}

export function createAiClient(): OpenAI {
  const settings = getAiSettings();
  return new OpenAI({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
  });
}

export function getCurrentModel(): string {
  return getAiSettings().model;
}

export function saveAiSettings(input: Partial<AiSettings> & { provider?: AiProviderKind }): AiSettings {
  const current = getAiSettings();
  const provider = input.provider || current.provider;
  const defaults = cloneDefault(provider);
  const providerChanged = provider !== current.provider;
  const merged: AiSettings = normalizeSettings({
    provider,
    apiKey: input.apiKey === undefined ? current.apiKey : input.apiKey,
    baseURL: input.baseURL === undefined ? (providerChanged ? defaults.baseURL : current.baseURL) : input.baseURL,
    model: input.model === undefined ? (providerChanged ? defaults.model : current.model) : input.model,
    modelOptions: input.modelOptions === undefined ? (providerChanged ? defaults.modelOptions : current.modelOptions) : input.modelOptions,
    balancePath: input.balancePath === undefined ? (providerChanged ? defaults.balancePath : current.balancePath) : input.balancePath,
  });
  cachedSettings = merged;
  applyToEnv(merged);
  atomicWriteJson(SETTINGS_PATH, { version: 1, ...merged });
  return merged;
}

export function getDefaultAiSettings(provider: AiProviderKind = "deepseek"): AiSettings {
  return cloneDefault(provider);
}
