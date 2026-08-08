export type ActivityKind = "you" | "voice" | "voice-tool" | "system" | "thinking" | "error";
export interface ActivityEntry { id: number; kind: ActivityKind; text: string; final: boolean; at: number }

export interface TurnRecord { kind: "you" | "voice"; text: string; at: number }

export class ActivityFeed {
  private nextId = 1;
  private entries: ActivityEntry[] = [];
  private liveIds = new Map<"you" | "voice", number>();
  private emitted = new Set<number>();

  constructor(private readonly onTurn?: (turn: TurnRecord) => void) {}

  /**
   * Fire the durable-log observer exactly once per committed conversational
   * turn. Replays and partials are excluded because they are never finalized
   * here (partials final later, replays are dropped before reaching `push`).
   */
  private emitTurn(entry: ActivityEntry): void {
    if (!entry.final) return;
    if (entry.kind !== "you" && entry.kind !== "voice") return;
    if (this.emitted.has(entry.id)) return;
    this.emitted.add(entry.id);
    this.onTurn?.({ kind: entry.kind, text: entry.text, at: entry.at });
  }

  transcript(kind: "you" | "voice", text: string, final: boolean): void {
    const clean = text.trim();
    if (!clean && !final) return;

    const existing = this.liveIds.get(kind);
    if (existing) {
      const entry = this.entries.find((item) => item.id === existing);
      if (entry) { entry.text = compact(clean || entry.text); entry.final = final; entry.at = Date.now(); }
      if (final && entry) this.emitTurn(entry);
      if (final) this.liveIds.delete(kind);
      this.trim();
      // A fragment from the other speaker is a hard turn boundary for the
      // still-live entry of this other/kind: commit it before the next turn.
      this.finalizeOther(kind);
      return;
    }
    if (!clean) return;
    // Replay detection must run before finalizeOther: committing the other
    // speaker's live entry here is exactly the barge-in boundary the replay is
    // a duplicate of, so the check has to see that entry as still live.
    if (final && this.isReplayedFinal(kind, clean)) return;
    // A transcript from the other speaker is a hard turn boundary. Commit the
    // previous live entry before starting the next one so late provider-final
    // events can never merge multiple conversational turns into one paragraph.
    this.finalizeOther(kind);
    const entry = this.push(kind, clean, final);
    if (!final) this.liveIds.set(kind, entry.id);
  }

  /**
   * Providers can deliver the same finalized transcript twice: a turn flushed
   * on barge-in (speech_started / interrupted) is often re-sent by the late
   * "done"/boundary event, and a session reconnect can replay the last
   * transcription. When no live entry remains for this speaker and the most
   * recent finalized entry of the same speaker already carries the exact same
   * text — with no finalized turn from the other speaker in between — the
   * incoming final is a replay of that message, not a new turn. Dropping it
   * keeps exactly one feed row per message.
   */
  private isReplayedFinal(kind: "you" | "voice", clean: string): boolean {
    let twin: ActivityEntry | undefined;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i]!;
      if (entry.kind !== kind) continue;
      twin = entry;
      break;
    }
    if (!twin || !twin.final || twin.text !== compact(clean)) return false;
    // The conversation must not have moved on: any finalized turn from the
    // other speaker after the twin means the repeated text is a genuine new
    // utterance (e.g. "yes" ... "yes"), not a replay.
    const otherKind = kind === "you" ? "voice" : "you";
    for (const entry of this.entries) {
      if (entry.id <= twin.id) continue;
      if (entry.kind === otherKind && entry.final) return false;
    }
    return true;
  }

  add(kind: Exclude<ActivityKind, "you" | "voice">, text: string): ActivityEntry {
    // Tool/system rows are chronological boundaries too. If Orb speaks, calls
    // a tool, then speaks again, the two speech fragments should render as two
    // distinct script turns around the tool row.
    this.finalizeLive();
    return this.push(kind, text, true);
  }

  /**
   * Append a lightweight non-conversation row WITHOUT committing any live
   * turn. Unlike {@link add} this never calls finalizeLive, so transient
   * thinking indicators can be opened/closed around streaming speech without
   * ever splitting one spoken sentence into multiple feed rows.
   */
  addNonBoundary(kind: Exclude<ActivityKind, "you" | "voice">, text: string): ActivityEntry {
    return this.push(kind, text, true);
  }

  finalize(kind?: "you" | "voice"): void {
    if (kind) this.finalizeOne(kind);
    else this.finalizeLive();
  }

  /**
   * True while a conversational turn is still streaming (not yet finalized).
   * Used by the thinking indicator so it never emits a row that would commit a
   * live turn mid-sentence and split one utterance into several feed rows.
   */
  isLive(kind?: "you" | "voice"): boolean {
    if (kind) return this.liveIds.has(kind);
    return this.liveIds.has("you") || this.liveIds.has("voice");
  }

  snapshot(limit = 32): ActivityEntry[] { return this.entries.slice(-limit).map((entry) => ({ ...entry })); }
  clear(): void { this.entries = []; this.liveIds.clear(); }

  private finalizeOther(kind: "you" | "voice"): void {
    this.finalizeOne(kind === "you" ? "voice" : "you");
  }
  private finalizeLive(): void { this.finalizeOne("you"); this.finalizeOne("voice"); }
  private finalizeOne(kind: "you" | "voice"): void {
    const id = this.liveIds.get(kind);
    if (!id) return;
    const entry = this.entries.find((item) => item.id === id);
    if (entry) { entry.final = true; this.emitTurn(entry); }
    this.liveIds.delete(kind);
  }
  private push(kind: ActivityKind, text: string, final: boolean): ActivityEntry {
    const entry = { id: this.nextId++, kind, text: compact(text), final, at: Date.now() };
    this.entries.push(entry);
    if (final) this.emitTurn(entry);
    this.trim();
    return entry;
  }
  private trim(): void { if (this.entries.length > 120) this.entries.splice(0, this.entries.length - 120); }
}
function compact(text: string): string { return text.replace(/\s+/g, " ").trim().slice(0, 5000); }
