export const AudioMessage = {
  Playback: 0x01,
  ClearPlayback: 0x02,
  SetMuted: 0x03,
  Shutdown: 0x04,
  Capture: 0x10,
  Levels: 0x11,
  Ready: 0x12,
  Error: 0x13,
} as const;

export interface AudioFrame { type: number; payload: Buffer }

export function encodeAudioFrame(type: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const frame = Buffer.allocUnsafe(5 + payload.length);
  frame[0] = type;
  frame.writeUInt32LE(payload.length, 1);
  payload.copy(frame, 5);
  return frame;
}

export class AudioFrameDecoder {
  private pending = Buffer.alloc(0);
  push(chunk: Buffer): AudioFrame[] {
    if (!chunk.length) return [];
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    const frames: AudioFrame[] = [];
    let offset = 0;
    while (this.pending.length - offset >= 5) {
      const size = this.pending.readUInt32LE(offset + 1);
      if (size > 8 * 1024 * 1024) throw new Error(`audio helper frame too large: ${size}`);
      if (this.pending.length - offset < 5 + size) break;
      const type = this.pending[offset]!;
      frames.push({ type, payload: this.pending.subarray(offset + 5, offset + 5 + size) });
      offset += 5 + size;
    }
    if (offset) this.pending = this.pending.subarray(offset);
    return frames;
  }
}
