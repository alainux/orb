import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { composeSystemPrompt } from "./policy.js";
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
  const permissionConfig = isObject(merged.permissions) ? merged.permissions : {};
  const audioConfig = isObject(merged.audio) ? merged.audio : {};
  const scratchpadConfig = isObject(merged.scratchpad) ? merged.scratchpad : {};

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
    ? (envFirst("GEMINI_VOICE") ?? providerConfig.voice ?? "Zephyr")
    : (envFirst("OPENAI_VOICE") ?? providerConfig.voice ?? "marin");

  const promptFile = envFirst("ORB_PROMPT_FILE", "PI_VOICE_PROMPT_FILE") ?? voiceConfig.promptFile;
  const inlinePrompt = envFirst("ORB_SYSTEM_PROMPT", "PI_VOICE_SYSTEM_PROMPT") ?? voiceConfig.systemPrompt;
  // Compose the final prompt with the simple two-layer model: the shipped
  // prompts/default.md is the authoritative default; a prompt file or inline
  // override (ORB_SYSTEM_PROMPT / voice.systemPrompt) replaces it entirely. With
  // neither, default.md is used as-is.
  let systemPrompt: string;
  if (typeof promptFile === "string" && promptFile.trim()) {
    const resolved = expandPath(promptFile, cwd);
    const layer = (await readFile(resolved, "utf8")).trim();
    if (!layer) throw new Error(`Voice prompt file is empty: ${resolved}`);
    systemPrompt = composeSystemPrompt(layer);
  } else if (typeof inlinePrompt === "string" && inlinePrompt.trim()) {
    systemPrompt = composeSystemPrompt(inlinePrompt);
  } else {
    systemPrompt = composeSystemPrompt();
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
    temperature: numberValue(envFirst("ORB_TEMPERATURE", "PI_VOICE_TEMPERATURE") ?? voiceConfig.temperature, 0.83, 0, 2, "temperature"),
    systemPrompt,
    orbAspect: numberValue(envFirst("ORB_ASPECT", "PI_VOICE_ORB_ASPECT") ?? uiConfig.orbAspect, 2, 0.45, 3, "ui.orbAspect"),
    orbDensity: numberValue(envFirst("ORB_DENSITY", "PI_VOICE_ORB_DENSITY") ?? uiConfig.orbDensity, 1.30, 0.7, 1.8, "ui.orbDensity"),
    orbReactivity: numberValue(envFirst("ORB_REACTIVITY", "PI_VOICE_ORB_REACTIVITY") ?? uiConfig.orbReactivity, 0.7, 0, 1, "ui.orbReactivity"),
    orbBraille: boolValue(envFirst("ORB_BRAILLE", "PI_VOICE_ORB_BRAILLE") ?? uiConfig.orbBraille, true, "ui.orbBraille"),
    panelHeight: Math.round(numberValue(envFirst("ORB_PANEL_HEIGHT", "PI_VOICE_PANEL_HEIGHT") ?? uiConfig.panelHeight, 12, 8, 24, "ui.panelHeight")),
    activityLines: Math.round(numberValue(envFirst("ORB_ACTIVITY_LINES", "PI_VOICE_ACTIVITY_LINES") ?? uiConfig.activityLines, 8, 3, 30, "ui.activityLines")),
    logDir: expandPath(String(logDirRaw ?? defaultLogDir), cwd),
    configFiles: loadedFiles,
    geminiSessionResumption: boolValue(envFirst("ORB_GEMINI_SESSION_RESUMPTION") ?? sessionConfig.geminiSessionResumption, true, "session.geminiSessionResumption"),
    geminiContextCompression: boolValue(envFirst("ORB_GEMINI_CONTEXT_COMPRESSION") ?? sessionConfig.geminiContextCompression, true, "session.geminiContextCompression"),
    geminiCompressionTriggerTokens: Math.round(numberValue(envFirst("ORB_GEMINI_COMPRESSION_TRIGGER_TOKENS") ?? sessionConfig.geminiCompressionTriggerTokens, 18000, 4000, 128000, "session.geminiCompressionTriggerTokens")),
    geminiCompressionTargetTokens: Math.round(numberValue(envFirst("ORB_GEMINI_COMPRESSION_TARGET_TOKENS") ?? sessionConfig.geminiCompressionTargetTokens, 9000, 2000, 64000, "session.geminiCompressionTargetTokens")),
    permissions: {
      cancelPi: boolValue(envFirst("ORB_ALLOW_CANCEL_PI") ?? permissionConfig.cancelPi, true, "permissions.cancelPi"),
      setModel: boolValue(envFirst("ORB_ALLOW_SET_MODEL") ?? permissionConfig.setModel, true, "permissions.setModel"),
      setThinking: boolValue(envFirst("ORB_ALLOW_SET_THINKING") ?? permissionConfig.setThinking, true, "permissions.setThinking"),
      setTools: boolValue(envFirst("ORB_ALLOW_SET_TOOLS") ?? permissionConfig.setTools, true, "permissions.setTools"),
      shell: boolValue(envFirst("ORB_ALLOW_SHELL") ?? permissionConfig.shell, true, "permissions.shell"),
      nativeTools: boolValue(envFirst("ORB_ALLOW_NATIVE_TOOLS") ?? permissionConfig.nativeTools, true, "permissions.nativeTools"),
      scratchpadRead: boolValue(envFirst("ORB_ALLOW_SCRATCHPAD_READ") ?? permissionConfig.scratchpadRead, true, "permissions.scratchpadRead"),
      scratchpadWrite: boolValue(envFirst("ORB_ALLOW_SCRATCHPAD_WRITE") ?? permissionConfig.scratchpadWrite, true, "permissions.scratchpadWrite"),
      scratchpadOutsideProject: boolValue(envFirst("ORB_ALLOW_SCRATCHPAD_OUTSIDE_PROJECT") ?? permissionConfig.scratchpadOutsideProject, false, "permissions.scratchpadOutsideProject"),
    },
    audio: {
      bufferMs: Math.round(numberValue(envFirst("ORB_AUDIO_BUFFER_MS") ?? audioConfig.bufferMs, 140, 40, 800, "audio.bufferMs")),
      maxBufferMs: Math.round(numberValue(envFirst("ORB_AUDIO_MAX_BUFFER_MS") ?? audioConfig.maxBufferMs, 380, 80, 1500, "audio.maxBufferMs")),
      recoveryStepMs: Math.round(numberValue(envFirst("ORB_AUDIO_RECOVERY_STEP_MS") ?? audioConfig.recoveryStepMs, 40, 10, 250, "audio.recoveryStepMs")),
      interruptionStormCount: Math.round(numberValue(envFirst("ORB_INTERRUPTION_STORM_COUNT") ?? audioConfig.interruptionStormCount, 3, 2, 10, "audio.interruptionStormCount")),
      interruptionStormWindowMs: Math.round(numberValue(envFirst("ORB_INTERRUPTION_STORM_WINDOW_MS") ?? audioConfig.interruptionStormWindowMs, 1800, 400, 10000, "audio.interruptionStormWindowMs")),
      interruptionRecoveryMuteMs: Math.round(numberValue(envFirst("ORB_INTERRUPTION_RECOVERY_MUTE_MS") ?? audioConfig.interruptionRecoveryMuteMs, 320, 0, 2000, "audio.interruptionRecoveryMuteMs")),
    },
    scratchpad: {
      panelHeight: Math.round(numberValue(envFirst("ORB_SCRATCHPAD_PANEL_HEIGHT") ?? scratchpadConfig.panelHeight, 18, 10, 32, "scratchpad.panelHeight")),
      maxBytes: Math.round(numberValue(envFirst("ORB_SCRATCHPAD_MAX_BYTES") ?? scratchpadConfig.maxBytes, 512 * 1024, 4096, 4 * 1024 * 1024, "scratchpad.maxBytes")),
    },
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
