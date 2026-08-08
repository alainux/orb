import { voiceOptions } from "./voices.js";
import type { VoiceConfig, VoiceProviderName } from "./types.js";

/**
 * Live, per-session preferences for Orb. Every key is optional: an absent key
 * falls back to the declared `.orb/config.json` default (or the documented
 * in-code default when no config file is present).
 *
 * Unlike the advanced tuning in `VoiceConfig`, these are the user-facing
 * toggles surfaced in the `/voice settings` panel. They are persisted through
 * the canonical Pi session mechanism (`pi.appendEntry` + branch restore) and
 * are scoped to the current Pi session — they never rewrite the user's config
 * file, and a fresh Pi launch starts from defaults again.
 */
export interface VoicePrefs {
  /** Reasoning-display mode for the feed (full / minimized / hidden). */
  thinking?: "full" | "minimized" | "hidden";
  /** Gemini Live reasoning budget (tokens); -1 = auto, 0 = off. */
  budget?: number;
  /** Auto-start voice when a Pi session begins. */
  autoStart?: boolean;
  /** Provider to use next session ("auto" honours env/default → gemini). */
  provider?: "auto" | "gemini" | "openai";
  /** Preferred voice name for the active provider. */
  voice?: string;
  /** Gemini context compression flag. */
  compression?: boolean;
  /** Gemini session resumption flag. */
  resumption?: boolean;
  /** Orb braille (visual feed) toggle. */
  braille?: boolean;
}

export type PrefKey = keyof VoicePrefs;

/** One selectable row shown in the `/voice settings` panel. */
export interface SettingDescriptor {
  id: PrefKey;
  /** TUI group heading (e.g. "Voice", "Reasoning", "Gemini session"). */
  group: string;
  label: string;
  description: string;
  /** Ordered display values the SettingsList cycles through. */
  values: string[];
  /** The user-facing current value. */
  currentValue: string;
}

/** Reasoning-budget presets offered by the panel → Gemini Live thinking tokens. */
export const BUDGET_PRESETS: ReadonlyArray<readonly [label: string, tokens: number]> = [
  ["off", 0],
  ["minimal", 512],
  ["standard", 1024],
  ["deep", 4096],
  ["max", 8192],
];

/** Everything the settings panel needs to build itself from live state. */
export interface PrefsView {
  prefs: VoicePrefs;
  config?: VoiceConfig | undefined;
  active: boolean;
  activeProvider?: VoiceProviderName | undefined;
  currentVoice?: string | undefined;
}

function onOff(value: boolean | undefined, fallback: boolean | undefined): string {
  return (value ?? fallback) ? "on" : "off";
}

/** Reasoning-budget label → Gemini Live tokens (fallback: 1024). */
export function tokensForBudget(label: string): number {
  for (const [name, tokens] of BUDGET_PRESETS) if (name === label) return tokens;
  return 1024;
}

/** Reasoning-budget tokens → nearest panel label (fallback: "standard"). */
export function labelForBudget(tokens: number): string {
  let best: readonly [string, number] = BUDGET_PRESETS[2]!;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const preset of BUDGET_PRESETS) {
    const dist = Math.abs(preset[1] - tokens);
    if (dist < bestDist) { best = preset; bestDist = dist; }
  }
  return best[0];
}

/** "on" | "off" → boolean. */
export function toggleFor(value: string): boolean { return value === "on"; }

/**
 * Build the complete, ordered set of preference rows for the panel. Pure and
 * dependency-light so it is unit-testable without a live controller, TUI, or
 * provider connection.
 */
export function buildPreferences(view: PrefsView): SettingDescriptor[] {
  const p = view.prefs;
  const cfg = view.config;
  const providerForVoice = p.provider && p.provider !== "auto"
    ? p.provider
    : ((view.activeProvider ?? cfg?.provider ?? "gemini") as VoiceProviderName);
  const voices = voiceOptions(providerForVoice);

  return [
    {
      id: "autoStart",
      group: "Voice",
      label: "Start voice with session",
      description: p.autoStart != null
        ? "Overrides the configured auto-start for this session."
        : "Auto-launches Orb when a Pi session begins.",
      values: ["on", "off"],
      currentValue: onOff(p.autoStart, cfg?.autoStartVoice),
    },
    {
      id: "provider",
      group: "Voice",
      label: "Provider",
      description: "Applies when Orb next starts or reconnects.",
      values: ["auto", "gemini", "openai"],
      currentValue: p.provider ?? (view.activeProvider ?? cfg?.provider ?? "auto"),
    },
    {
      id: "voice",
      group: "Voice",
      label: "Voice",
      description: view.active
        ? "Switches the active voice immediately."
        : "Preferred voice for the selected provider.",
      values: voices,
      currentValue: view.currentVoice ?? p.voice ?? cfg?.voice ?? voices[0] ?? "",
    },
    {
      id: "thinking",
      group: "Reasoning",
      label: "Reveal reasoning",
      description: "How the model's reasoning (Thinking…/thought text) is surfaced in the feed.",
      values: ["full", "minimized", "hidden"],
      currentValue: p.thinking ?? cfg?.thinkingDisplay ?? "minimized",
    },
    {
      id: "budget",
      group: "Reasoning",
      label: "Thinking budget",
      description: "How much the Gemini voice model reasons before replying.",
      values: BUDGET_PRESETS.map(([label]) => label),
      currentValue: labelForBudget(p.budget ?? cfg?.geminiThinkingBudget ?? 1024),
    },
    {
      id: "compression",
      group: "Gemini session",
      label: "Context compression",
      description: "Compress long Gemini sessions to stay within context.",
      values: ["on", "off"],
      currentValue: onOff(p.compression, cfg?.geminiContextCompression),
    },
    {
      id: "resumption",
      group: "Gemini session",
      label: "Session resumption",
      description: "Reuse a prior Gemini Live session where the API supports it.",
      values: ["on", "off"],
      currentValue: onOff(p.resumption, cfg?.geminiSessionResumption),
    },
    {
      id: "braille",
      group: "Visual",
      label: "Orb braille",
      description: "Render the charter feed as animated braille when idle.",
      values: ["on", "off"],
      currentValue: onOff(p.braille, cfg?.orbBraille),
    },
  ];
}
/**
 * Convert a user-selected panel label into the delta it should apply to the
 * stored preference map. Unknown labels fall back to a sane default per key.
 */
export function parseSettingValue(id: PrefKey, label: string): Partial<VoicePrefs> {
  switch (id) {
    case "thinking": {
      const v = label.toLowerCase();
      return { thinking: v === "full" ? "full" : v === "hidden" ? "hidden" : "minimized" };
    }
    case "budget": return { budget: tokensForBudget(label) };
    case "autoStart": return { autoStart: toggleFor(label) };
    case "provider": {
      const v = label.toLowerCase();
      return { provider: v === "openai" ? "openai" : v === "gemini" ? "gemini" : "auto" };
    }
    case "voice": return { voice: label };
    case "compression": return { compression: toggleFor(label) };
    case "resumption": return { resumption: toggleFor(label) };
    case "braille": return { braille: toggleFor(label) };
  }
}
