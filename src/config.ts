import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { composeSystemPrompt } from "./policy.js";
import type { VoiceConfig, VoiceProviderName, ThinkingDisplay } from "./types.js";

type JsonObject = Record<string, unknown>;

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
export function thinkingDisplayValue(value: unknown, fallback: ThinkingDisplay, label: string): ThinkingDisplay {
  if (value === undefined || value === null || value === "") return fallback;
  const s = String(value).trim().toLowerCase();
  if (["full", "show", "verbose"].includes(s)) return "full";
  if (["minimized", "min", "summary", "snippet"].includes(s)) return "minimized";
  if (["hidden", "hide", "off", "none"].includes(s)) return "hidden";
  throw new Error(`${label} must be "full", "minimized", or "hidden"`);
}

export function defaultConfigPaths(cwd: string): string[] {
  const userBase = process.platform === "win32" && process.env.APPDATA
    ? process.env.APPDATA
    : (process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config"));
  return [join(userBase, "orb", "config.json"), join(cwd, ".orb", "config.json")];
}

/**
 * True when the current process is running as a sub-agent tab spawned inside the
 * Herdr (herdr.dev) terminal multiplexer, as opposed to a top-level instance
 * launched directly from bash.
 *
 * A top-level instance launched directly from bash is *not* inside a Herdr pane,
 * so it inherits no `HERDR_*` at all. Every process that runs in a Herdr pane
 * inherits `HERDR_ENV=1` (plus `HERDR_PANE_ID`/`HERDR_TAB_ID`/
 * `HERDR_WORKSPACE_ID`/`HERDR_SOCKET_PATH`) from the pane shell. Harnesses such
 * as the Factory spawn worker panes via Herdr's built-in launcher
 * (`herdr agent start --kind pi -- ... --name <agent>`) and do *not* set any
 * `PI_SUBAGENT_*`; only the `pi-herdr-subagents` extension does. So the robust
 * discriminator is `HERDR_ENV`, with `PI_SUBAGENT_*` as a stricter confirmation
 * when present.
 */
export function isHerdrSubAgent(): boolean {
  if (process.env.PI_SUBAGENT_ID ||
      process.env.PI_SUBAGENT_NAME ||
      process.env.PI_SUBAGENT_SESSION ||
      process.env.PI_SUBAGENT_SURFACE) {
    return true;
  }
  return process.env.HERDR_ENV === "1";
}

/**
 * Decide whether Orb voice should auto-start when a Pi session begins.
 *
 * Defaults to `true`. Can be disabled either in the config.json via the top-level
 * `autoStartVoice` key, or per-launch via the `ORB_AUTO_START` environment
 * variable. Voice is never auto-launched in a Herdr sub-agent tab (see
 * `isHerdrSubAgent`) unless it is explicitly turned on — this keeps one voice
 * session per top-level instance and avoids an audio stack in every sub-agent
 * pane. An explicit `ORB_AUTO_START=true` or `autoStartVoice: true` still wins.
 * Unlike `loadVoiceConfig`, this never requires provider API keys, so the
 * extension can consult it before any voice session exists.
 */
export async function resolveAutoStartVoice(cwd = process.cwd()): Promise<boolean> {
  const envValue = envFirst("ORB_AUTO_START");
  if (envValue !== undefined) return boolValue(envValue, true, "ORB_AUTO_START");
  let merged: JsonObject = {};
  const explicit = envFirst("ORB_CONFIG", "PI_VOICE_CONFIG");
  const candidates = [...defaultConfigPaths(cwd), ...(explicit ? [expandPath(explicit, cwd)] : [])];
  for (const path of candidates) {
    const parsed = await readJsonIfPresent(path);
    if (parsed) merged = deepMerge(merged, parsed);
  }
  return boolValue(merged.autoStartVoice, !isHerdrSubAgent(), "autoStartVoice");
}

export interface MergedVoiceConfig {
  /** Fully deep-merged config data. */
  merged: JsonObject;
  /** The config files that were read, in precedence order. */
  configFiles: string[];
}

/** Read and deep-merge the Orb config files for a working directory. */
export async function readMergedVoiceConfig(cwd = process.cwd()): Promise<MergedVoiceConfig> {
  let merged: JsonObject = {};
  const configFiles: string[] = [];
  const explicit = envFirst("ORB_CONFIG", "PI_VOICE_CONFIG");
  const candidates = [...defaultConfigPaths(cwd), ...(explicit ? [expandPath(explicit, cwd)] : [])];
  for (const path of candidates) {
    const parsed = await readJsonIfPresent(path);
    if (!parsed) continue;
    merged = deepMerge(merged, parsed);
    configFiles.push(path);
  }
  return { merged, configFiles };
}

/** Resolve the effective provider name (explicit > env > config > "gemini"). */
export function resolveProviderName(providerOverride: VoiceProviderName | undefined, merged: JsonObject): VoiceProviderName {
  const raw = (providerOverride ?? envFirst("ORB_PROVIDER", "PI_VOICE_PROVIDER") ?? merged.provider ?? "gemini").toString().toLowerCase();
  if (raw !== "gemini" && raw !== "openai") throw new Error(`provider must be "gemini" or "openai"; received ${JSON.stringify(raw)}`);
  return raw as VoiceProviderName;
}

/** The provider's API key from the environment (empty string when unset). */
export function configuredApiKey(provider: VoiceProviderName): string {
  return provider === "gemini"
    ? (envFirst("GEMINI_API_KEY", "GOOGLE_API_KEY") ?? "")
    : (envFirst("OPENAI_API_KEY") ?? "");
}

/**
/**
 * The user config file a UI-collected API key or a command-selected voice is
 * persisted to: an explicit `ORB_CONFIG`/`PI_VOICE_CONFIG` when set, otherwise
 * the user-level default (`~/.config/orb/config.json`, or APPDATA on Windows).
 * Keys or voice choices stay out of the project-scoped
 * `<localProj>/.orb/config.json` so a secret (or an author preference) is
 * never checked in or shared across machines.
 */
export function userConfigPath(cwd = process.cwd()): string {
  const explicit = envFirst("ORB_CONFIG", "PI_VOICE_CONFIG");
  return explicit ? expandPath(explicit, cwd) : defaultConfigPaths(cwd)[0] as string;
}

/**
 * Persist `provider`'s API key to the user config file so a UI-collected key
 * survives restarts. Merges into any existing config (stored under the
 * provider block) and writes atomically (temp file + rename, like the
 * scratchpad and Go-helper writers). Returns the written path. The persisted
 * key is a startup fallback only — an env var, or a key passed explicitly to
 * `loadVoiceConfig`, always wins.
 */
export async function persistApiKey(provider: VoiceProviderName, apiKey: string, cwd = process.cwd()): Promise<string> {
  const target = userConfigPath(cwd);
  let existing: JsonObject = {};
  try {
    const parsed = JSON.parse(await readFile(target, "utf8"));
    if (isObject(parsed)) existing = parsed;
  } catch {
    // Missing or unreadable config: start from an empty object.
  }
  const providerBlock = isObject(existing[provider]) ? existing[provider] : {};
  const next: JsonObject = { ...existing, [provider]: { ...providerBlock, apiKey } };
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.orb-${process.pid}-${Date.now()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
  return target;
}

/**
 * Persist `provider`'s user-selected voice to the user config file so a
 * `/voice voice <name>` choice survives a restart and round-trips through
 * `loadVoiceConfig` (which reads `{ provider: { voice } }`). Merges into any
 * existing config and writes atomically (temp file + rename), storing under the
 * same provider block as the API key. Returns the written path. The persisted
 * voice is a startup fallback only — an explicit env var (`GEMINI_VOICE`/
 * `OPENAI_VOICE`) or a config-file `voice` key always wins on load.
 */
export async function persistVoice(provider: VoiceProviderName, voice: string, cwd = process.cwd()): Promise<string> {
  const target = userConfigPath(cwd);
  let existing: JsonObject = {};
  try {
    const parsed = JSON.parse(await readFile(target, "utf8"));
    if (isObject(parsed)) existing = parsed;
  } catch {
    // Missing or unreadable config: start from an empty object.
  }
  const providerBlock = isObject(existing[provider]) ? existing[provider] : {};
  const next: JsonObject = { ...existing, [provider]: { ...providerBlock, voice } };
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.orb-${process.pid}-${Date.now()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
  return target;
}

/**
 * Persist top-level preference fields (e.g. `{ provider, autoStartVoice }`) to
 * the user config file so panel-made choices survive restarts. Merges into any
 * existing config and writes atomically (temp file + rename, like
 * `persistApiKey`/`persistVoice`). Returns the written path.
 */
export async function persistTopLevel(fields: JsonObject, cwd = process.cwd()): Promise<string> {
  const target = userConfigPath(cwd);
  let existing: JsonObject = {};
  try {
    const parsed = JSON.parse(await readFile(target, "utf8"));
    if (isObject(parsed)) existing = parsed;
  } catch {
    // Missing or unreadable config: start from an empty object.
  }
  const next: JsonObject = { ...existing, ...fields };
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.orb-${process.pid}-${Date.now()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
  return target;
}

export interface LoadVoiceConfigOptions {
  /** An API key already collected from the user (e.g. via a UI prompt). */
  apiKey?: string;
}

export async function loadVoiceConfig(
  providerOverride?: VoiceProviderName,
  cwd = process.cwd(),
  options: LoadVoiceConfigOptions = {},
): Promise<VoiceConfig> {
  const { merged, configFiles: loadedFiles } = await readMergedVoiceConfig(cwd);
  const provider = resolveProviderName(providerOverride, merged);
  const providerConfig = isObject(merged[provider]) ? merged[provider] : {};
  const voiceConfig = isObject(merged.voice) ? merged.voice : {};
  const uiConfig = isObject(merged.ui) ? merged.ui : {};
  const sessionConfig = isObject(merged.session) ? merged.session : {};
  const loggingConfig = isObject(merged.logging) ? merged.logging : {};
  const permissionConfig = isObject(merged.permissions) ? merged.permissions : {};
  const audioConfig = isObject(merged.audio) ? merged.audio : {};
  const scratchpadConfig = isObject(merged.scratchpad) ? merged.scratchpad : {};

  // Key precedence: an explicitly collected key > env var > persisted config
  // (`{ provider: { apiKey } }` written by persistApiKey from the UI prompt).
  const persistedKey = typeof providerConfig.apiKey === "string" ? providerConfig.apiKey.trim() : "";
  const apiKey = options.apiKey?.trim() || configuredApiKey(provider) || persistedKey;
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
    autoStartVoice: boolValue(envFirst("ORB_AUTO_START") ?? merged.autoStartVoice, !isHerdrSubAgent(), "autoStartVoice"),
    activityLines: Math.round(numberValue(envFirst("ORB_ACTIVITY_LINES", "PI_VOICE_ACTIVITY_LINES") ?? uiConfig.activityLines, 8, 3, 30, "ui.activityLines")),
    // Reasoning visibility for the feed. Defaults to `minimized` (a short
    // clipped summary); `full` renders the whole thought, `hidden` keeps only
    // the ephemeral status indicator. Env/JSON key: ui.thinkingDisplay.
    thinkingDisplay: thinkingDisplayValue(envFirst("ORB_THINKING_DISPLAY") ?? uiConfig.thinkingDisplay, "minimized", "ui.thinkingDisplay"),
    logDir: expandPath(String(logDirRaw ?? defaultLogDir), cwd),
    configFiles: loadedFiles,
    geminiSessionResumption: boolValue(envFirst("ORB_GEMINI_SESSION_RESUMPTION") ?? sessionConfig.geminiSessionResumption, true, "session.geminiSessionResumption"),
    geminiContextCompression: boolValue(envFirst("ORB_GEMINI_CONTEXT_COMPRESSION") ?? sessionConfig.geminiContextCompression, true, "session.geminiContextCompression"),
    geminiCompressionTriggerTokens: Math.round(numberValue(envFirst("ORB_GEMINI_COMPRESSION_TRIGGER_TOKENS") ?? sessionConfig.geminiCompressionTriggerTokens, 18000, 4000, 128000, "session.geminiCompressionTriggerTokens")),
    geminiCompressionTargetTokens: Math.round(numberValue(envFirst("ORB_GEMINI_COMPRESSION_TARGET_TOKENS") ?? sessionConfig.geminiCompressionTargetTokens, 9000, 2000, 64000, "session.geminiCompressionTargetTokens")),
    // Voice-model thinking budget (tokens) for Gemini Live. 0 = disabled (no
    // thinkingConfig sent → fastest responses; the Thinking… indicator only
    // opens when a budget is configured). The default is a small but real
    // positive budget (1024) so the model actually reasons a little out of the
    // box. -1 = model's automatic budget, positive = explicit cap.
    geminiThinkingBudget: Math.round(numberValue(envFirst("ORB_GEMINI_THINKING_BUDGET") ?? sessionConfig.geminiThinkingBudget, 1024, -1, 65536, "session.geminiThinkingBudget")),
    // Minimum ms the "Thinking…" indicator stays visible once a turn opens, so a
    // flash model that delivers its first audio in the same batch as the turn
    // opening (on→off coalescing) can't make the indicator blink unseen.
    geminiThinkingHoldMs: Math.round(numberValue(envFirst("ORB_GEMINI_THINKING_HOLD_MS") ?? sessionConfig.geminiThinkingHoldMs, 380, 0, 5000, "session.geminiThinkingHoldMs")),
    permissions: {
      scratchpadRead: boolValue(envFirst("ORB_ALLOW_SCRATCHPAD_READ") ?? permissionConfig.scratchpadRead, true, "permissions.scratchpadRead"),
      scratchpadWrite: boolValue(envFirst("ORB_ALLOW_SCRATCHPAD_WRITE") ?? permissionConfig.scratchpadWrite, true, "permissions.scratchpadWrite"),
      scratchpadOutsideProject: boolValue(envFirst("ORB_ALLOW_SCRATCHPAD_OUTSIDE_PROJECT") ?? permissionConfig.scratchpadOutsideProject, false, "permissions.scratchpadOutsideProject"),
      cancelPi: boolValue(envFirst("ORB_ALLOW_CANCEL_PI") ?? permissionConfig.cancelPi, true, "permissions.cancelPi"),
    },
    audio: {
      bufferMs: Math.round(numberValue(envFirst("ORB_AUDIO_BUFFER_MS") ?? audioConfig.bufferMs, 140, 40, 800, "audio.bufferMs")),
      maxBufferMs: Math.round(numberValue(envFirst("ORB_AUDIO_MAX_BUFFER_MS") ?? audioConfig.maxBufferMs, 380, 80, 1500, "audio.maxBufferMs")),
      recoveryStepMs: Math.round(numberValue(envFirst("ORB_AUDIO_RECOVERY_STEP_MS") ?? audioConfig.recoveryStepMs, 40, 10, 250, "audio.recoveryStepMs")),
      interruptionStormCount: Math.round(numberValue(envFirst("ORB_INTERRUPTION_STORM_COUNT") ?? audioConfig.interruptionStormCount, 3, 2, 10, "audio.interruptionStormCount")),
      interruptionStormWindowMs: Math.round(numberValue(envFirst("ORB_INTERRUPTION_STORM_WINDOW_MS") ?? audioConfig.interruptionStormWindowMs, 1800, 400, 10000, "audio.interruptionStormWindowMs")),
      interruptionRecoveryMuteMs: Math.round(numberValue(envFirst("ORB_INTERRUPTION_RECOVERY_MUTE_MS") ?? audioConfig.interruptionRecoveryMuteMs, 320, 0, 2000, "audio.interruptionRecoveryMuteMs")),
      choppinessWindowRecoveries: Math.round(numberValue(envFirst("ORB_CHOPPINESS_WINDOW_RECOVERIES") ?? audioConfig.choppinessWindowRecoveries, 3, 2, 20, "audio.choppinessWindowRecoveries")),
      choppinessWindowMs: Math.round(numberValue(envFirst("ORB_CHOPPINESS_WINDOW_MS") ?? audioConfig.choppinessWindowMs, 1500, 500, 10000, "audio.choppinessWindowMs")),
      choppinessRecoverSilenceMs: Math.round(numberValue(envFirst("ORB_CHOPPINESS_RECOVER_SILENCE_MS") ?? audioConfig.choppinessRecoverSilenceMs, 1500, 400, 10000, "audio.choppinessRecoverSilenceMs")),
      inputResyncDrops: Math.round(numberValue(envFirst("ORB_INPUT_RESYNC_DROPS") ?? audioConfig.inputResyncDrops, 3, 1, 20, "audio.inputResyncDrops")),
      inputResyncWindowMs: Math.round(numberValue(envFirst("ORB_INPUT_RESYNC_WINDOW_MS") ?? audioConfig.inputResyncWindowMs, 1500, 400, 10000, "audio.inputResyncWindowMs")),
      inputResyncCooldownMs: Math.round(numberValue(envFirst("ORB_INPUT_RESYNC_COOLDOWN_MS") ?? audioConfig.inputResyncCooldownMs, 4000, 500, 30000, "audio.inputResyncCooldownMs")),
      stallGapMs: Math.round(numberValue(envFirst("ORB_AUDIO_STALL_GAP_MS") ?? audioConfig.stallGapMs, 150, 50, 2000, "audio.stallGapMs")),
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
  } catch (error: unknown) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "ENOENT") return undefined;
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
