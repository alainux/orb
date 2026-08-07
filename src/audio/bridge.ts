import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { RunLog } from "../log.js";
import type { AudioConfig } from "../types.js";
import { AudioFrameDecoder, AudioMessage, encodeAudioFrame } from "./protocol.js";
import { resolveAudioHelper } from "./helper-resolution.js";

export interface AudioLevels {
  inputRms: number;
  outputRms: number;
  captureDrops: number;
  queuedBytes: number;
  recoveries: number;
}

export class GoAudioBridge extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | undefined;
  private decoder = new AudioFrameDecoder();
  private closing = false;

  constructor(private readonly log: RunLog, private readonly config: AudioConfig) { super(); }

  async start(): Promise<void> {
    const helper = await resolveAudioHelper(this.log);
    await this.log.info("starting Go audio helper", { helper: helper.path, source: helper.source, audioBufferMs: this.config.bufferMs, audioMaxBufferMs: this.config.maxBufferMs });
    const child = spawn(helper.path, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ORB_AUDIO_BUFFER_MS: String(this.config.bufferMs),
        ORB_AUDIO_MAX_BUFFER_MS: String(this.config.maxBufferMs),
        ORB_AUDIO_RECOVERY_STEP_MS: String(this.config.recoveryStepMs),
      },
    });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => {
      try { for (const frame of this.decoder.push(chunk)) this.handleFrame(frame.type, frame.payload); }
      catch (error) { this.emit("error", asError(error)); }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text: string) => {
      const clean = String(text).trim(); if (!clean) return;
      void this.log.info("audio helper stderr", { text: clean });
    });
    child.on("error", (error) => this.emit("error", error));
    child.on("exit", (code, signal) => {
      if (this.closing) return;
      this.emit("error", new Error(`Go audio helper exited unexpectedly (${code ?? signal ?? "unknown"})`));
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Go audio helper did not become ready within 8 seconds")), 8000);
      const onReady = () => { clearTimeout(timer); this.off("error", onError); resolve(); };
      const onError = (error: Error) => { clearTimeout(timer); this.off("ready", onReady); reject(error); };
      this.once("ready", onReady); this.once("error", onError);
    });
  }

  enqueueOutput(pcm24k: Buffer): void { if (pcm24k.length) this.write(AudioMessage.Playback, pcm24k); }
  endOutput(): void { this.write(AudioMessage.PlaybackEnd); }
  clearOutput(): void { this.write(AudioMessage.ClearPlayback); }
  setMuted(muted: boolean): void { this.write(AudioMessage.SetMuted, Buffer.from([muted ? 1 : 0])); }

  async close(): Promise<void> {
    if (!this.child) return;
    this.closing = true;
    try { this.write(AudioMessage.Shutdown); } catch {}
    const child = this.child; this.child = undefined;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 1200);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    await this.log.info("Go audio helper stopped");
  }

  private write(type: number, payload?: Buffer): void {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed) return;
    stdin.write(encodeAudioFrame(type, payload));
  }

  private handleFrame(type: number, payload: Buffer): void {
    switch (type) {
      case AudioMessage.Capture: this.emit("input", Buffer.from(payload)); break;
      case AudioMessage.Levels:
        if (payload.length >= 24) this.emit("levels", {
          inputRms: payload.readDoubleLE(0), outputRms: payload.readDoubleLE(8),
          captureDrops: payload.readUInt32LE(16), queuedBytes: payload.readUInt32LE(20),
          recoveries: payload.length >= 28 ? payload.readUInt32LE(24) : 0,
        } satisfies AudioLevels);
        break;
      case AudioMessage.Ready: this.emit("ready"); break;
      case AudioMessage.Error: this.emit("error", new Error(payload.toString("utf8") || "audio helper error")); break;
    }
  }
}

function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
