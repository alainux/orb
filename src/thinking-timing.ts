import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Output-agnostic tracker for the voice "Thinking…" indicator.
 *
 * Every voice provider (Gemini Live, OpenAI Realtime, ...) reports thinking
 * state changes through `sink.onThinking(...)`; the controller funnels those
 * into `observe()`. This writes a stable, ordered record of every `start` / `stop`
 * boundary plus the measured duration of each "Thinking on" window (`held` ms),
 * so the indicator's real visibility can be diagnosed even when it flashes
 * quickly enough that a frame never paints. By default those records go to a
 * dedicated file (not the main console); the controller supplies `createFileLog`.
 * Because it lives at the controller (the shared sink boundary) rather than inside
 * one provider, it applies uniformly to every supported model.
 */
export interface ThinkingTrackerOptions {
  /** Wall-clock source; injectable for deterministic tests. Defaults to Date.now. */
  now?: () => number;
  /** Output sink; injectable for assertions. Defaults to console.log. */
  log?: (line: string) => void;
}

export class ThinkingTracker {
  private startedAt = 0;
  private seq = 0;
  private on = false;
  private readonly now: () => number;
  private readonly out: (line: string) => void;

  constructor(private readonly label: string, options?: ThinkingTrackerOptions) {
    this.now = options?.now ?? Date.now;
    this.out = options?.log ?? ((line: string) => console.log(line));
  }

  /** True when a "Thinking…" window is currently open. */
  get active(): boolean {
    return this.on;
  }

  /** Record a provider-reported thinking transition (edge-triggered/deduped). */
  observe(value: boolean): void {
    if (value) {
      // Already on (e.g. a duplicate start): no boundary, nothing to log.
      if (this.on) return;
      this.on = true;
      this.startedAt = this.now();
      this.seq += 1;
      this.out(`[orb-thinking] start seq=${this.seq} at=${new Date(this.startedAt).toISOString()} model=${this.label}`);
      return;
    }
    // Already off: ignore redundant clears so stop is only emitted once per window.
    if (!this.on) return;
    const stopAt = this.now();
    const held = stopAt - this.startedAt;
    this.on = false;
    this.seq += 1;
    this.out(`[orb-thinking] stop seq=${this.seq} at=${new Date(stopAt).toISOString()} held=${held}ms model=${this.label}`);
    this.startedAt = 0;
  }

  /** Force a stop boundary if one is open (e.g. session teardown); no-op if off. */
  reset(): void {
    if (this.on) this.observe(false);
  }
}

/** Human-readable label that ties a trace line to a specific provider/model. */
export function thinkingLabel(provider: string, model: string): string {
  return `${provider}·${model}`;
}

/**
 * Build a line-appender that persists each trace line to a dedicated log file
 * (default `orb-thinking.log`) instead of the main console, so the detailed
 * per-transition records stay out of the UI/output stream.
 */
export function createFileLog(dir: string, filename = "orb-thinking.log"): (line: string) => void {
  const path = join(dir, filename);
  let chain: Promise<void> = mkdir(dir, { recursive: true }).then(() => undefined);
  return (line: string) => {
    chain = chain.then(() => appendFile(path, `${line}\n`, "utf8")).catch(() => undefined);
  };
}