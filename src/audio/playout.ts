import type { AudioLevels } from "./bridge.js";

/**
 * Playout phase, exposed for observability (widget/status) and so callers only
 * surface a recovery message at meaningful transitions.
 */
export type PlayoutPhase = "healthy" | "choppy" | "recovering";

export interface PlayoutMonitorOptions {
  /** How many sidecar underrun recoveries within `windowMs` count as a choppy episode. */
  windowRecoveries: number;
  /** Sliding window (ms) over which recoveries are counted for onset. */
  windowMs: number;
  /** Quiet interval (ms) with no further underruns after which the episode is clean. */
  recoverSilenceMs: number;
  /** Capture-drop publishes (within `inputResyncWindowMs`) that warrant auto-resyncing the input path. */
  inputResyncDrops: number;
  /** Capture-drop sampling window (ms). */
  inputResyncWindowMs: number;
  /** Min gap between automatic input resyncs (ms). */
  inputResyncCooldownMs: number;
}

export interface PlayoutMonitorSnapshot {
  phase: PlayoutPhase;
  episodes: number;
  /** When the most recent episode began (monotonic ms). */
  lastChoppyStartMs: number;
  queuedMs: number;
}

export interface PlayoutMonitorCallbacks {
  /** Emitted the moment sustained choppiness is first detected. */
  onChoppyStart?: (episode: number, queuedMs: number) => void;
  /** Emitted once output has been clean for `recoverSilenceMs`. */
  onRecovered?: (episode: number, lagMs: number) => void;
  /** Emitted when the Node should resync capture because frames were dropped while output was choppy. */
  onAutoResyncInput?: (reason: string) => void;
}

export type PlayoutMonitorOptionsInput = Partial<PlayoutMonitorOptions>;

const defaultOptions: Required<PlayoutMonitorOptions> = {
  windowRecoveries: 3,
  windowMs: 1500,
  recoverSilenceMs: 1500,
  inputResyncDrops: 3,
  inputResyncWindowMs: 1500,
  inputResyncCooldownMs: 4000,
};

/**
 * Reliable, clock-driven detector of *sustained* audio choppiness built on the
 * one honest hardware signal we have: the Go sidecar's underrun-recovery
 * counter. Each increment of `recoveries` is exactly one playback pause the
 * sidecar took to avoid emitting a partial audio fragment — i.e. one audible
 * glitch. A single recovery is a normal transient stall (Pi renders, a tool
 * runs); a cluster of recoveries inside a short window is choppiness beginning.
 *
 * The monitor is a pure decision node: it never touches the playout buffer.
 * Actual recovery is performed by the wire (Go buffer: accelerated re-prime +
 * latency relaxation) and by the controller (input resync when the mic starves
 * with the speaker).
 */
export class PlayoutMonitor {
  private readonly opts: Required<PlayoutMonitorOptions>;
  private phase: PlayoutPhase = "healthy";
  private lastRecoveries = 0;
  private lastCaptureDrops = 0;
  private lastQueuedMs = 0;
  /** nowMs of each recovery increment still inside the onset window (ascending). */
  private readonly recoveryEvents: number[] = [];
  /** nowMs of each publish whose capture-drop counter advanced (inside the drop window). */
  private readonly captureDropEvents: number[] = [];
  /** nowMs of the most recent underlock recovery, kept independently of pruning. */
  private lastRecoveryAt = -Infinity;
  private choppyStartMs = 0;
  private episodeCount = 0;
  private lastInputResyncMs = -Infinity;

  constructor(
    private readonly callbacks: PlayoutMonitorCallbacks,
    options?: PlayoutMonitorOptionsInput,
  ) {
    this.opts = { ...defaultOptions, ...options };
  }

  /** Reset all state (call whenever a fresh audio stack is started). */
  reset(): void {
    this.phase = "healthy";
    this.lastRecoveries = 0;
    this.lastCaptureDrops = 0;
    this.lastQueuedMs = 0;
    this.recoveryEvents.length = 0;
    this.captureDropEvents.length = 0;
    this.lastRecoveryAt = -Infinity;
    this.choppyStartMs = 0;
    this.episodeCount = 0;
    this.lastInputResyncMs = -Infinity;
  }

  snapshot(): PlayoutMonitorSnapshot {
    return { phase: this.phase, episodes: this.episodeCount, lastChoppyStartMs: this.choppyStartMs, queuedMs: this.lastQueuedMs };
  }

  /** Feed one `Levels` frame from the Go sidecar (≈20 Hz). */
  publish(levels: AudioLevels, nowMs = Date.now()): void {
    this.lastQueuedMs = Math.round((levels.queuedBytes / (24_000 * 2)) * 1000);

    if (levels.recoveries !== this.lastRecoveries) {
      const delta = levels.recoveries - this.lastRecoveries;
      for (let i = 0; i < delta; i++) this.recoveryEvents.push(nowMs);
      this.lastRecoveryAt = Math.max(this.lastRecoveryAt, nowMs);
      this.lastRecoveries = levels.recoveries;
    }
    if (levels.captureDrops !== this.lastCaptureDrops) {
      this.captureDropEvents.push(nowMs);
      this.lastCaptureDrops = levels.captureDrops;
    }
    this.dropStale(this.recoveryEvents, nowMs, this.opts.windowMs);
    this.dropStale(this.captureDropEvents, nowMs, this.opts.inputResyncWindowMs);

    if (this.phase !== "choppy") {
      // An underrun cluster = sustained choppiness; a lone recovery = a normal
      // transient stall, and it is imperceptible — stay healthy.
      if (this.countRecent(this.recoveryEvents, nowMs, this.opts.windowMs) >= this.opts.windowRecoveries) {
        this.onset(nowMs);
      }
      return;
    }

    // A choppy episode is in progress: age it out once output has been clean
    // for `recoverSilenceMs`, and meanwhile resync a starving mic.
    if (nowMs - this.lastRecoveryAt >= this.opts.recoverSilenceMs) {
      this.recover(nowMs);
      return;
    }

    if (nowMs - this.lastInputResyncMs >= this.opts.inputResyncCooldownMs) {
      if (this.countRecent(this.captureDropEvents, nowMs, this.opts.inputResyncWindowMs) >= this.opts.inputResyncDrops) {
        this.lastInputResyncMs = nowMs;
        this.callbacks.onAutoResyncInput?.("capture frames dropped while output choppy");
      }
    }
  }

  private onset(nowMs: number): void {
    this.phase = "choppy";
    this.episodeCount++;
    this.choppyStartMs = nowMs;
    this.callbacks.onChoppyStart?.(this.episodeCount, this.lastQueuedMs);
  }

  private recover(nowMs: number): void {
    this.phase = "healthy";
    this.lastInputResyncMs = -Infinity;
    const lagMs = nowMs - this.choppyStartMs;
    this.recoveryEvents.length = 0;
    this.callbacks.onRecovered?.(this.episodeCount, lagMs);
  }

  /** Keep only events still relevant to `windowMs` to bound memory. */
  private dropStale(events: number[], nowMs: number, windowMs: number): void {
    const cutoff = nowMs - windowMs;
    let i = 0;
    while (i < events.length && events[i]! < cutoff) i++;
    if (i) events.splice(0, i);
  }

  private countRecent(events: number[], nowMs: number, windowMs: number): number {
    const cutoff = nowMs - windowMs;
    let count = 0;
    for (const t of events) if (t >= cutoff) count++;
    return count;
  }
}