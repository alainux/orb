import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_VOICE_SYSTEM_PROMPT } from "./policy.js";
import type { VoiceConfig, VoiceProviderName } from "./types.js";

type JsonObject = Record<string, any>;

function envFirst(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}
function numberValue(value: unknown, fallback: number, min: number, max: number, label: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return parsed;
}
function boolValue(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${label} must be true or false`);
}

export function defaultConfigPaths(cwd: string): string[] {
  const userBase = process.platform === "win32" && process.env.APPDATA
    ? process.env.APPDATA
    : (process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config"));
  return [join(userBase, "orb", "config.json"), join(cwd, ".orb", "config.json")];
}

export async function loadVoiceConfig(providerOverride?: VoiceProviderName, cwd = process.cwd()): Promise<VoiceConfig> {
  let merged: JsonObject = {};
  const loadedFiles: string[] = [];
  const explicit = envFirst("ORB_CONFIG", "PI_VOICE_CONFIG");
  const candidates = [...defaultConfigPaths(cwd), ...(explicit ? [expandPath(explicit, cwd)] : [])];
  for (const path of candidates) {
    const parsed = await readJsonIfPresent(path);
    if (!parsed) continue;
    merged = deepMerge(merged, parsed);
    loadedFiles.push(path);
  }

  const providerRaw = (providerOverride ?? envFirst("ORB_PROVIDER", "PI_VOICE_PROVIDER") ?? merged.provider ?? "gemini").toString().toLowerCase();
  if (providerRaw !== "gemini" && providerRaw !== "openai") throw new Error(`provider must be "gemini" or "openai"; received ${JSON.stringify(providerRaw)}`);
  const provider = providerRaw as VoiceProviderName;
  const providerConfig = isObject(merged[provider]) ? merged[provider] : {};
  const voiceConfig = isObject(merged.voice) ? merged.voice : {};
  const uiConfig = isObject(merged.ui) ? merged.ui : {};
  const sessionConfig = isObject(merged.session) ? merged.session : {};
  const loggingConfig = isObject(merged.logging) ? merged.logging : {};

  const apiKey = provider === "gemini"
    ? (envFirst("GEMINI_API_KEY", "GOOGLE_API_KEY") ?? "")
    : (envFirst("OPENAI_API_KEY") ?? "");
  if (!apiKey) throw new Error(provider === "gemini"
    ? "Set GEMINI_API_KEY (or GOOGLE_API_KEY) before starting /voice."
    : "Set OPENAI_API_KEY before starting /voice.");

  const model = provider === "gemini"
    ? (envFirst("GEMINI_LIVE_MODEL") ?? providerConfig.model ?? "gemini-3.1-flash-live-preview")
    : (envFirst("OPENAI_REALTIME_MODEL") ?? providerConfig.model ?? "gpt-realtime-2.1");
  const voice = provider === "gemini"
    ? (envFirst("GEMINI_VOICE") ?? providerConfig.voice ?? "Aoede")
    : (envFirst("OPENAI_VOICE") ?? providerConfig.voice ?? "marin");

  const promptFile = envFirst("ORB_PROMPT_FILE", "PI_VOICE_PROMPT_FILE") ?? voiceConfig.promptFile;
  const inlinePrompt = envFirst("ORB_SYSTEM_PROMPT", "PI_VOICE_SYSTEM_PROMPT") ?? voiceConfig.systemPrompt;
  let systemPrompt = typeof inlinePrompt === "string" && inlinePrompt.trim() ? inlinePrompt.trim() : DEFAULT_VOICE_SYSTEM_PROMPT;
  if (typeof promptFile === "string" && promptFile.trim()) {
    const resolved = expandPath(promptFile, cwd);
    systemPrompt = (await readFile(resolved, "utf8")).trim();
    if (!systemPrompt) throw new Error(`Voice prompt file is empty: ${resolved}`);
  }

  const logDirRaw = envFirst("ORB_LOG_DIR", "PI_VOICE_LOG_DIR") ?? loggingConfig.dir;
  const defaultLogDir = process.platform === "win32" && process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "orb", "logs")
    : join(homedir(), ".cache", "orb", "logs");

  return {
    provider,
    apiKey,
    model: String(model),
    voice: String(voice),
    temperature: numberValue(envFirst("ORB_TEMPERATURE", "PI_VOICE_TEMPERATURE") ?? voiceConfig.temperature, 0.72, 0, 2, "temperature"),
    systemPrompt,
    greetingEnabled: boolValue(envFirst("ORB_GREETING", "PI_VOICE_GREETING") ?? voiceConfig.greeting, true, "voice.greeting"),
    orbAspect: numberValue(envFirst("ORB_ASPECT", "PI_VOICE_ORB_ASPECT") ?? uiConfig.orbAspect, 2, 0.45, 3, "ui.orbAspect"),
    orbDensity: numberValue(envFirst("ORB_DENSITY", "PI_VOICE_ORB_DENSITY") ?? uiConfig.orbDensity, 1.10, 0.7, 1.6, "ui.orbDensity"),
    panelHeight: Math.round(numberValue(envFirst("ORB_PANEL_HEIGHT", "PI_VOICE_PANEL_HEIGHT") ?? uiConfig.panelHeight, 14, 9, 24, "ui.panelHeight")),
    activityLines: Math.round(numberValue(envFirst("ORB_ACTIVITY_LINES", "PI_VOICE_ACTIVITY_LINES") ?? uiConfig.activityLines, 10, 4, 30, "ui.activityLines")),
    logDir: expandPath(String(logDirRaw ?? defaultLogDir), cwd),
    configFiles: loadedFiles,
    geminiSessionResumption: boolValue(envFirst("ORB_GEMINI_SESSION_RESUMPTION") ?? sessionConfig.geminiSessionResumption, true, "session.geminiSessionResumption"),
    geminiContextCompression: boolValue(envFirst("ORB_GEMINI_CONTEXT_COMPRESSION") ?? sessionConfig.geminiContextCompression, true, "session.geminiContextCompression"),
    geminiCompressionTriggerTokens: Math.round(numberValue(envFirst("ORB_GEMINI_COMPRESSION_TRIGGER_TOKENS") ?? sessionConfig.geminiCompressionTriggerTokens, 18000, 4000, 128000, "session.geminiCompressionTriggerTokens")),
    geminiCompressionTargetTokens: Math.round(numberValue(envFirst("ORB_GEMINI_COMPRESSION_TARGET_TOKENS") ?? sessionConfig.geminiCompressionTargetTokens, 9000, 2000, 64000, "session.geminiCompressionTargetTokens")),
  };
}

async function readJsonIfPresent(path: string): Promise<JsonObject | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!isObject(parsed)) throw new Error("root must be an object");
    return parsed;
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    throw new Error(`Could not load Orb config ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function deepMerge(base: JsonObject, next: JsonObject): JsonObject {
  const out: JsonObject = { ...base };
  for (const [key, value] of Object.entries(next)) out[key] = isObject(value) && isObject(out[key]) ? deepMerge(out[key], value) : value;
  return out;
}
function isObject(value: unknown): value is JsonObject { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function expandPath(path: string, cwd: string): string {
  const expanded = path.startsWith("~/") || path.startsWith("~\\") ? join(homedir(), path.slice(2)) : path;
  return resolve(expanded.startsWith(".") ? cwd : dirname(expanded) === "." ? cwd : "", expanded);
}
