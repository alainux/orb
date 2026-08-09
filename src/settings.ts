import type { ThinkingDisplay, VoiceConfig } from "./types.js";
import { voiceOptions } from "./voices.js";

/**
 * The `/voice settings` panel.
 *
 * Rows fall into three kinds, reflecting the durable-vs-session split:
 *
 * - **Session toggle (editable, in-memory):** the reasoning *display* is a live
 *   setting for the current Pi session only — `controller.setThinkingDisplay`
 *   rewrites the running value in memory; it is never written to a file nor to
 *   a session entry, and a fresh launch starts from the config default again.
 * - **Durable preferences (editable, persisted):** the settings users most
 *   often want to change from the panel — provider, voice, and auto-start.
 *   Changing one applies live where possible (`setVoice`) and always persists
 *   to the user config file so the choice survives restarts.
 * - **Config reference (read-only):** the remaining durable preferences
 *   currently in effect (model, thinking budget, compression, resumption),
 *   read from the config file at startup. Shown for transparency; to change
 *   them you edit the config file (`~/.config/orb/config.json` or
 *   `<project>/.orb/config.json`).
 */
export interface VoiceSettingsRow {
  id: string;
  group: string;
  label: string;
  description: string;
  /** Ordered values the SettingsList cycles through (present ⇒ editable). */
  values?: string[] | undefined;
  /** Human-readable current value (a config field for read-only rows). */
  currentValue: string;
}

/** The editable row ids handled by `applyVoiceSetting`. */
export type EditableSetting = "thinking" | "voice" | "provider" | "autostart";

/** Inputs the catalog needs from live controller state. */
export interface VoiceSettingsView {
  thinking: ThinkingDisplay;
  config?: VoiceConfig | undefined;
}

/** Readable label for a Gemini thinking budget (tokens); durable reference row. */
export function budgetLabel(budget: number | undefined): string {
  if (budget === undefined) return "model default";
  if (budget === 0) return "off";
  if (budget === -1) return "auto (dynamic)";
  return `${budget} tokens`;
}

/**
 * CSI-u (Kitty keyboard protocol) encodings of a plain Space press/repeat.
 * Pi asks terminals for the Kitty protocol at startup (flags 1|2|4), so on
 * kitty-capable terminals (kitty, wezterm, Ghostty, foot, iTerm2 with key
 * reporting, Konsole, …) a Space key arrives as one of these sequences rather
 * than the literal `" "` byte. Grammar (modifier 1 = none, `:Pt` = event type):
 *
 *   \x1b[32u            flag 1 only
 *   \x1b[32;1u          flag 1, explicit no-modifier
 *   \x1b[32;1:1u        flags 1|2, press (repeat = `:2`, release = `:3`)
 *   \x1b[32:32:32;1:1u  flags 1|2|4, alternate keys for space
 *   \x1b[32:32;1u       flags 1|4, only the shifted key reported
 */
const KITTY_PLAIN_SPACE = /^\x1b\[32(?::\d+){0,2}(?:;1)?(?::[123])?u$/;

/**
 * Normalize the raw key data pi delivers to the `/voice settings` panel.
 * `SettingsList` only cycles/applies on the literal `" "` character, so under
 * the Kitty keyboard protocol (where Space arrives as a CSI-u sequence) the
 * Space key silently does nothing while Enter keeps working. Map the
 * no-modifier CSI-u encodings of Space back to `" "` so both keys behave
 * identically. Modified keys (Ctrl/Alt+Space) and everything else pass through
 * untouched.
 */
export function normalizePanelKey(data: string): string {
  return KITTY_PLAIN_SPACE.test(data) ? " " : data;
}

/** Build the ordered rows for the `/voice settings` panel. */
export function buildVoiceSettings(view: VoiceSettingsView): VoiceSettingsRow[] {
  const cfg = view.config;
  const rows: VoiceSettingsRow[] = [
    {
      id: "thinking",
      group: "Session",
      label: "Reveal reasoning",
      description: "Session-only: how the model's reasoning is surfaced in the feed. A fresh launch honors the `ui.thinkingDisplay` config default again.",
      values: ["full", "minimized", "hidden"],
      currentValue: view.thinking,
    },
  ];
  if (cfg) {
    rows.push(
      {
        id: "provider", group: "Voice", label: "Provider",
        description: "Gemini or OpenAI realtime voice for the next /voice session (persisted).",
        values: ["gemini", "openai"],
        currentValue: cfg.provider,
      },
      {
        id: "voice", group: "Voice", label: "Voice",
        description: "Cycle the provider's voices; switching while live also speaks a short audition (persisted).",
        values: voiceOptions(cfg.provider),
        currentValue: cfg.voice || "auto",
      },
      {
        id: "autostart", group: "Startup", label: "Auto-start voice",
        description: "Start Orb voice automatically when a Pi session begins (persisted).",
        values: ["on", "off"],
        currentValue: cfg.autoStartVoice ? "on" : "off",
      },
      {
        id: "ref.model", group: "Config", label: "Model",
        description: "From config file.",
        currentValue: cfg.model,
      },
      {
        id: "ref.budget", group: "Config", label: "Thinking budget",
        description: "From config file: governs the reasoning window behind the 'Thinking…' indicator.",
        currentValue: budgetLabel(cfg.geminiThinkingBudget),
      },
      {
        id: "ref.compression", group: "Config", label: "Context compression",
        description: "From config file.",
        currentValue: cfg.geminiCompressionTriggerTokens ? `${cfg.geminiCompressionTriggerTokens} tokens` : "off",
      },
      {
        id: "ref.resumption", group: "Config", label: "Session resumption",
        description: "From config file.",
        currentValue: cfg.geminiSessionResumption ? "on" : "off",
      },
    );
  }
  return rows;
}