import fs from "fs";
import path from "path";
import os from "os";
import OpenAI from "openai";
import { getRuntimeDataDir } from "./runtime-data";

export type AiProviderKind =
  | "deepseek"
  | "openai"
  | "qwen"
  | "zhipu"
  | "moonshot"
  | "siliconflow"
  | "openai-compatible";

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
  openai: {
    provider: "openai",
    apiKey: "",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-5.5",
    modelOptions: ["gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
    balancePath: "",
  },
  qwen: {
    provider: "qwen",
    apiKey: "",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.7-max",
    modelOptions: ["qwen3.7-max", "qwen3.7-plus", "qwen3.6-flash", "qwen3.5-omni-plus"],
    balancePath: "",
  },
  zhipu: {
    provider: "zhipu",
    apiKey: "",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5.2",
    modelOptions: ["glm-5.2", "glm-5-turbo", "glm-4.7", "glm-4.6"],
    balancePath: "",
  },
  moonshot: {
    provider: "moonshot",
    apiKey: "",
    baseURL: "https://api.moonshot.cn/v1",
    model: "kimi-k3",
    modelOptions: ["kimi-k3", "kimi-k2.7-code", "kimi-k2.6", "kimi-k2.5"],
    balancePath: "",
  },
  siliconflow: {
    provider: "siliconflow",
    apiKey: "",
    baseURL: "https://api.siliconflow.cn/v1",
    model: "Qwen/Qwen3.5-397B-A17B",
    modelOptions: ["Qwen/Qwen3.5-397B-A17B", "deepseek-ai/DeepSeek-V3.2", "deepseek-ai/DeepSeek-R1-0528", "zai-org/GLM-5"],
    balancePath: "",
  },
  "openai-compatible": {
    provider: "openai-compatible",
    apiKey: "",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-5.5",
    modelOptions: ["gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
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

function normalizeProvider(value: unknown): AiProviderKind {
  return typeof value === "string" && value in DEFAULT_SETTINGS
    ? value as AiProviderKind
    : "deepseek";
}

function normalizeModelOptions(value: unknown, provider: AiProviderKind): string[] {
  if (!Array.isArray(value)) return cloneDefault(provider).modelOptions;
  const options = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  if (options.length === 0) return cloneDefault(provider).modelOptions;
  const legacyOptions = {
    qwen: ["qwen-plus", "qwen-max", "qwen-turbo", "qwen-long"],
    zhipu: ["glm-4-flash", "glm-4-plus", "glm-4-air", "glm-4-long"],
    moonshot: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    siliconflow: ["Qwen/Qwen2.5-7B-Instruct", "deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1"],
  } as Partial<Record<AiProviderKind, string[]>>;
  if (JSON.stringify(options) === JSON.stringify(legacyOptions[provider])) return cloneDefault(provider).modelOptions;
  return Array.from(new Set(options)).slice(0, 20);
}

function inferProvider(baseURL: string): AiProviderKind {
  if (/deepseek/i.test(baseURL)) return "deepseek";
  if (/dashscope|aliyuncs|qwen/i.test(baseURL)) return "qwen";
  if (/bigmodel|zhipu/i.test(baseURL)) return "zhipu";
  if (/moonshot/i.test(baseURL)) return "moonshot";
  if (/siliconflow/i.test(baseURL)) return "siliconflow";
  if (/api\.openai\.com/i.test(baseURL)) return "openai";
  return "openai-compatible";
}

function normalizeSettings(input: Partial<AiSettings> & { provider?: AiProviderKind }): AiSettings {
  const currentProvider = normalizeProvider(input.provider);
  const defaults = cloneDefault(currentProvider);
  const provider = currentProvider;
  const baseURL = typeof input.baseURL === "string" && input.baseURL.trim()
    ? input.baseURL.trim().replace(/\/+$/, "")
    : defaults.baseURL;
  const legacyDefaults: Partial<Record<AiProviderKind, string>> = {
    qwen: "qwen-plus",
    zhipu: "glm-4-flash",
    moonshot: "moonshot-v1-8k",
    siliconflow: "Qwen/Qwen2.5-7B-Instruct",
  };
  const inputModel = typeof input.model === "string" ? input.model.trim() : "";
  const model = inputModel && inputModel !== legacyDefaults[provider] ? inputModel : defaults.model;
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
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8")) as Partial<AiSettings> & { provider?: AiProviderKind };
      return normalizeSettings(raw);
    } catch {
      return null;
    }
  }

  if (process.env.PORTABLE_EXECUTABLE_DIR?.trim()) {
    const legacyPath = path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "WahtWay",
      "data",
      "ai-settings.json"
    );
    if (!fs.existsSync(legacyPath)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(legacyPath, "utf-8")) as Partial<AiSettings> & { provider?: AiProviderKind };
      const normalized = normalizeSettings(raw);
      atomicWriteJson(SETTINGS_PATH, { version: 1, ...normalized });
      return normalized;
    } catch {
      return null;
    }
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
