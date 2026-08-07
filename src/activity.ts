export type ActivityKind = "you" | "voice" | "voice-tool" | "system" | "error";
export interface ActivityEntry { id: number; kind: ActivityKind; text: string; final: boolean; at: number }

export class ActivityFeed {
  private nextId = 1;
  private entries: ActivityEntry[] = [];
  private liveIds = new Map<"you" | "voice", number>();

  transcript(kind: "you" | "voice", text: string, final: boolean): void {
    const clean = text.trim();
    if (!clean && !final) return;
    const existing = this.liveIds.get(kind);
    if (existing) {
      const entry = this.entries.find((item) => item.id === existing);
      if (entry) { entry.text = clean || entry.text; entry.final = final; entry.at = Date.now(); }
      if (final) this.liveIds.delete(kind);
      this.trim();
      return;
    }
    if (!clean) return;
    const entry = this.push(kind, clean, final);
    if (!final) this.liveIds.set(kind, entry.id);
  }

  add(kind: Exclude<ActivityKind, "you" | "voice">, text: string): ActivityEntry {
    return this.push(kind, text, true);
  }
  snapshot(limit = 32): ActivityEntry[] { return this.entries.slice(-limit).map((entry) => ({ ...entry })); }
  clear(): void { this.entries = []; this.liveIds.clear(); }

  private push(kind: ActivityKind, text: string, final: boolean): ActivityEntry {
    const entry = { id: this.nextId++, kind, text: compact(text), final, at: Date.now() };
    this.entries.push(entry);
    this.trim();
    return entry;
  }
  private trim(): void { if (this.entries.length > 120) this.entries.splice(0, this.entries.length - 120); }
}
function compact(text: string): string { return text.replace(/\s+/g, " ").trim().slice(0, 5000); }
