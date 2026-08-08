import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
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
 * The config file that runtime preference writes are persisted to.
 *
 * An explicit `ORB_CONFIG`/`PI_VOICE_CONFIG` always wins (it is the canonical
 * location the user pointed Orb at). Otherwise we write to the project-level
 * `<cwd>/.orb/config.json`, which is the most locally-scoped file Orb actually
 * reads from `defaultConfigPaths` and the natural place a preference toggle
 * (think: `ui.thinkingDisplay`) belongs.
 */
export function writeConfigPath(cwd: string = process.cwd()): string {
  const explicit = envFirst("ORB_CONFIG", "PI_VOICE_CONFIG");
  if (explicit) return expandPath(explicit, cwd);
  return join(cwd, ".orb", "config.json");
}

/**
 * Persist the reasoning-display preference (`ui.thinkingDisplay`) into the
 * user's Orb config file so it survives restarts. The file is read (merging in
 * any existing keys), the value updated, and written back atomically (temp file
 * + rename). Safe to call before any voice session exists.
 */
export async function persistThinkingDisplay(mode: ThinkingDisplay, cwd = process.cwd()): Promise<string> {
  const path = writeConfigPath(cwd);
  let merged: JsonObject = {};
  const existing = await readJsonIfPresent(path).catch(() => undefined);
  if (existing) merged = existing;
  merged = deepMerge(merged, { ui: { thinkingDisplay: mode } });
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  await rename(temp, path);
  return path;
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
      cancelPi: boolValue(envFirst("ORB_ALLOW_CANCEL_PI") ?? permissionConfig.cancelPi, true, "permissions.cancelPi"),
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
      choppinessWindowRecoveries: Math.round(numberValue(envFirst("ORB_CHOPPINESS_WINDOW_RECOVERIES") ?? audioConfig.choppinessWindowRecoveries, 3, 2, 20, "audio.choppinessWindowRecoveries")),
      choppinessWindowMs: Math.round(numberValue(envFirst("ORB_CHOPPINESS_WINDOW_MS") ?? audioConfig.choppinessWindowMs, 1500, 500, 10000, "audio.choppinessWindowMs")),
      choppinessRecoverSilenceMs: Math.round(numberValue(envFirst("ORB_CHOPPINESS_RECOVER_SILENCE_MS") ?? audioConfig.choppinessRecoverSilenceMs, 1500, 400, 10000, "audio.choppinessRecoverSilenceMs")),
      inputResyncDrops: Math.round(numberValue(envFirst("ORB_INPUT_RESYNC_DROPS") ?? audioConfig.inputResyncDrops, 3, 1, 20, "audio.inputResyncDrops")),
      inputResyncWindowMs: Math.round(numberValue(envFirst("ORB_INPUT_RESYNC_WINDOW_MS") ?? audioConfig.inputResyncWindowMs, 1500, 400, 10000, "audio.inputResyncWindowMs")),
      inputResyncCooldownMs: Math.round(numberValue(envFirst("ORB_INPUT_RESYNC_COOLDOWN_MS") ?? audioConfig.inputResyncCooldownMs, 4000, 500, 30000, "audio.inputResyncCooldownMs")),
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
