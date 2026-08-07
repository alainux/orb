export type ActivityKind = "you" | "voice" | "voice-tool" | "system" | "error";
export interface ActivityEntry { id: number; kind: ActivityKind; text: string; final: boolean; at: number }

export class ActivityFeed {
  private nextId = 1;
  private entries: ActivityEntry[] = [];
  private liveIds = new Map<"you" | "voice", number>();

  transcript(kind: "you" | "voice", text: string, final: boolean): void {
    const clean = text.trim();
    if (!clean && !final) return;

    // A transcript from the other speaker is a hard turn boundary. Commit the
    // previous live entry before starting the next one so late provider-final
    // events can never merge multiple conversational turns into one paragraph.
    this.finalizeOther(kind);

    const existing = this.liveIds.get(kind);
    if (existing) {
      const entry = this.entries.find((item) => item.id === existing);
      if (entry) { entry.text = compact(clean || entry.text); entry.final = final; entry.at = Date.now(); }
      if (final) this.liveIds.delete(kind);
      this.trim();
      return;
    }
    if (!clean) return;
    const entry = this.push(kind, clean, final);
    if (!final) this.liveIds.set(kind, entry.id);
  }

  add(kind: Exclude<ActivityKind, "you" | "voice">, text: string): ActivityEntry {
    // Tool/system rows are chronological boundaries too. If Orb speaks, calls
    // a tool, then speaks again, the two speech fragments should render as two
    // distinct script turns around the tool row.
    this.finalizeLive();
    return this.push(kind, text, true);
  }

  finalize(kind?: "you" | "voice"): void {
    if (kind) this.finalizeOne(kind);
    else this.finalizeLive();
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
    if (entry) entry.final = true;
    this.liveIds.delete(kind);
  }
  private push(kind: ActivityKind, text: string, final: boolean): ActivityEntry {
    const entry = { id: this.nextId++, kind, text: compact(text), final, at: Date.now() };
    this.entries.push(entry);
    this.trim();
    return entry;
  }
  private trim(): void { if (this.entries.length > 120) this.entries.splice(0, this.entries.length - 120); }
}
function compact(text: string): string { return text.replace(/\s+/g, " ").trim().slice(0, 5000); }
