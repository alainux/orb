import type { ThinkingDisplay, VoiceConfig } from "./types.js";

/**
 * Session, TEMPORARY runtime toggles for Orb — deliberately distinct from
 * durable configuration.
 *
 * Pi keeps the two concerns separate (see its settings docs and the extension
 * session pattern in examples/extensions/tools.ts):
 *
 * - **Durable preferences** (provider, model, voice, auto-start, reasoning
 *   budget, audio tuning, …) live in an optional config file
 *   (`~/.config/orb/config.json` or `<project>/.orb/config.json`) read at
 *   startup. They are the source of declared defaults.
 * - **Temporary session toggles** like "reveal reasoning" affect only the
 *   current session: they are persisted via `pi.appendEntry` and restored from
 *   the session branch, and a fresh Pi launch starts again from the config
 *   defaults. Toggling never writes to the config file.
 *
 * This module models only the temporary-session layer.
 */
export interface SessionPrefs {
  /** Reasoning-display mode for the feed (full / minimized / hidden). */
  thinking?: ThinkingDisplay;
}

export type PrefKey = keyof SessionPrefs;

/** One row the `/voice settings` panel shows for a session toggle. */
export interface SettingDescriptor {
  id: PrefKey;
  group: string;
  label: string;
  description: string;
  /** Ordered display values the SettingsList cycles through. */
  values: string[];
  /** The user-facing current value. */
  currentValue: string;
}

/** Everything the session-toggle panel needs from live state. */
export interface SessionView {
  prefs: SessionPrefs;
  config?: VoiceConfig | undefined;
}

/** The ordered set of temporary session toggles shown in `/voice settings`. */
export function buildSessionToggles(view: SessionView): SettingDescriptor[] {
  const p = view.prefs;
  const cfg = view.config;
  return [
    {
      id: "thinking",
      group: "Session",
      label: "Reveal reasoning",
      description:
        "Temporary for this session only — how the model's reasoning is surfaced in the feed. " +
        "Pin a persistent default with `ui.thinkingDisplay` in the config file.",
      values: ["full", "minimized", "hidden"],
      currentValue: p.thinking ?? cfg?.thinkingDisplay ?? "minimized",
    },
  ];
}

/**
 * Convert a selected panel label into the delta it should apply. Only the
 * temporary session toggles are handled here; durable preferences are edited in
 * the config file, not toggled at runtime.
 */
export function parseSessionToggle(id: PrefKey, label: string): Partial<SessionPrefs> {
  const v = label.toLowerCase();
  switch (id) {
    case "thinking":
      return { thinking: v === "full" ? "full" : v === "hidden" ? "hidden" : "minimized" };
  }
}