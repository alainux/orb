export class PcmInputAdapter {
  private pending = Buffer.alloc(0);
  private resamplePending = Buffer.alloc(0);
  readonly outputRate: number;
  readonly chunkBytes: number;

  constructor(outputRate: number) {
    if (outputRate !== 16_000 && outputRate !== 24_000) throw new Error(`unsupported provider input rate ${outputRate}`);
    this.outputRate = outputRate;
    this.chunkBytes = outputRate * 2 * 20 / 1000;
  }

  push(capture24k: Buffer): Buffer[] {
    const converted = this.outputRate === 24_000 ? capture24k : this.resample24To16(capture24k);
    if (!converted.length) return [];
    this.pending = this.pending.length ? Buffer.concat([this.pending, converted]) : Buffer.from(converted);
    const chunks: Buffer[] = [];
    while (this.pending.length >= this.chunkBytes) {
      chunks.push(Buffer.from(this.pending.subarray(0, this.chunkBytes)));
      this.pending = this.pending.subarray(this.chunkBytes);
    }
    return chunks;
  }

  reset(): void { this.pending = Buffer.alloc(0); this.resamplePending = Buffer.alloc(0); }

  private resample24To16(input: Buffer): Buffer {
    const bytes = this.resamplePending.length ? Buffer.concat([this.resamplePending, input]) : input;
    const sampleCount = Math.floor(bytes.length / 2);
    const groups = Math.floor(sampleCount / 3);
    if (!groups) { this.resamplePending = Buffer.from(bytes); return Buffer.alloc(0); }
    const out = Buffer.allocUnsafe(groups * 4);
    let o = 0;
    for (let g = 0; g < groups; g++) {
      const base = g * 6;
      const a = bytes.readInt16LE(base);
      const b = bytes.readInt16LE(base + 2);
      const c = bytes.readInt16LE(base + 4);
      out.writeInt16LE(a, o);
      out.writeInt16LE(Math.trunc((b + c) / 2), o + 2);
      o += 4;
    }
    this.resamplePending = Buffer.from(bytes.subarray(groups * 6));
    return out;
  }
}
