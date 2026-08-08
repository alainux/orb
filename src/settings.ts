import type { ThinkingDisplay, VoiceConfig } from "./types.js";

/**
 * The `/voice settings` panel.
 *
 * It has exactly two kinds of rows, reflecting the durable-vs-session split:
 *
 * - **Session toggles (editable):** live, temporary settings for the current Pi
 *   session only — today the reasoning *display*. Changing one rewrites the
 *   running value in memory (see `controller.setThinkingDisplay`); it is never
 *   written to a file nor to a session entry, and a fresh launch starts from
 *   the config default again.
 * - **Config reference (read-only):** the durable preferences currently in
 *   effect, read from the config file at startup. Shown for transparency; to
 *   change them you edit the config file (`~/.config/orb/config.json` or
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

/** The editable session-toggle ids handled by `applyVoiceSetting`. */
export type EditableSetting = "thinking";

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
        id: "ref.provider", group: "Config", label: "Provider",
        description: "From config file; change it there, not here.",
        currentValue: cfg.provider,
      },
      {
        id: "ref.model", group: "Config", label: "Model",
        description: "From config file.",
        currentValue: cfg.model,
      },
      {
        id: "ref.voice", group: "Config", label: "Voice",
        description: "From config file (cycle live with /voice voice).",
        currentValue: cfg.voice || "auto",
      },
      {
        id: "ref.budget", group: "Config", label: "Thinking budget",
        description: "From config file: governs the reasoning window behind the 'Thinking…' indicator.",
        currentValue: budgetLabel(cfg.geminiThinkingBudget),
      },
      {
        id: "ref.autostart", group: "Config", label: "Auto-start",
        description: "From config file.",
        currentValue: cfg.autoStartVoice ? "on" : "off",
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