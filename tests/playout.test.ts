import assert from "node:assert/strict";
import test from "node:test";
import { PlayoutMonitor } from "../src/audio/playout.js";
import type { AudioLevels } from "../src/audio/bridge.js";

function levels(partial: Partial<AudioLevels> = {}): AudioLevels {
  return { inputRms: 0, outputRms: 0, captureDrops: 0, queuedBytes: 0, recoveries: 0, ...partial };
}

test("a single underrun recovery stays healthy (normal transient stall)", () => {
  const calls: string[] = [];
  const m = new PlayoutMonitor({ onChoppyStart: () => calls.push("chop"), onRecovered: () => calls.push("ok") }, {
    windowRecoveries: 3, windowMs: 1500, recoverSilenceMs: 1500, inputResyncDrops: 3, inputResyncWindowMs: 1500, inputResyncCooldownMs: 4000,
  });
  m.publish(levels({ recoveries: 0 }), 0);
  m.publish(levels({ recoveries: 1 }), 100); // single glitch
  m.publish(levels({ recoveries: 1 }), 200);
  m.publish(levels({ recoveries: 1 }), 300);
  m.publish(levels({ recoveries: 2 }), 2000); // a second, much later
  assert.deepEqual(calls, []);
  assert.equal(m.snapshot().phase, "healthy");
});

test("a cluster of recoveries in a window detects sustained choppiness and later recovery", () => {
  const events: string[] = [];
  const m = new PlayoutMonitor(
    { onChoppyStart: (ep, q) => events.push(`chop:${ep}:${q}`), onRecovered: (ep, lag) => events.push(`rec:${ep}:${lag}`) },
    { windowRecoveries: 3, windowMs: 1500, recoverSilenceMs: 1500, inputResyncDrops: 99, inputResyncWindowMs: 1500, inputResyncCooldownMs: 4000 },
  );
  const word = (recoveries: number, bytes: number, t: number) => m.publish(levels({ recoveries, queuedBytes: bytes }), t);

  word(0, 2400, 0);
  word(1, 0, 50);
  word(2, 0, 150);
  word(3, 0, 250); // third recovery in <1.5s -> onset
  assert.equal(m.snapshot().phase, "choppy");
  assert.deepEqual(events.map((e) => e.split(":")[0]), ["chop"]);

  word(4, 2400, 200); // a couple more, then silence
  word(4, 2400, 400);
  word(4, 2400, 1000);
  word(4, 2400, 3000); // >1.5s since last recovery -> recovered (lag ~2750ms)
  assert.equal(m.snapshot().phase, "healthy");
  assert.deepEqual(events.map((e) => e.split(":")[0]), ["chop", "rec"]);
  // episodes observed (count is stable, emission checked above)
  assert.ok(m.snapshot().episodes >= 1);
});

test("capture-drop spike during an episode auto-resyncs the input (with cooldown)", () => {
  const resyncs: string[] = [];
  const m = new PlayoutMonitor({ onAutoResyncInput: () => resyncs.push("resync") }, {
    windowRecoveries: 3, windowMs: 1500, recoverSilenceMs: 1500, inputResyncDrops: 3, inputResyncWindowMs: 1500, inputResyncCooldownMs: 4000,
  });
  const word = (rec: number, drops: number, t: number) => m.publish(levels({ recoveries: rec, captureDrops: drops, queuedBytes: 0 }), t);

  // Choppy episode begins at t≈200 with several recoveries.
  word(1, 0, 0);
  word(2, 0, 100);
  word(3, 0, 200); // onset
  // A capture-drop cluster inside the window triggers the first auto-resync.
  word(4, 1, 300);
  word(5, 2, 400);
  word(6, 3, 500); // resync #1
  // Continuing drops inside the cooldown (4s) must NOT resync again.
  word(7, 4, 600);
  word(8, 5, 700);
  assert.equal(resyncs.length, 1);

  // After the cooldown elapses (t≥4500) and old drop events have aged out, a
  // fresh 3-drop cluster resyncs once more.
  word(9, 6, 5000); // last resync at 500 -> 4s+cooldown satisfied
  word(10, 7, 5300);
  word(11, 8, 5600); // 5000/5300/5600 all inside the drop window -> resync #2
  assert.equal(resyncs.length, 2);
});

test("reset clears state back to healthy", () => {
  const m = new PlayoutMonitor({}, { windowRecoveries: 2, windowMs: 1500, recoverSilenceMs: 1000, inputResyncDrops: 3, inputResyncWindowMs: 1500, inputResyncCooldownMs: 4000 });
  m.publish(levels({ recoveries: 1 }), 0);
  m.publish(levels({ recoveries: 2 }), 100);
  assert.equal(m.snapshot().phase, "choppy");
  m.reset();
  assert.equal(m.snapshot().phase, "healthy");
  assert.equal(m.snapshot().episodes, 0);
});

test("peak queuedMs captures the worst latency inside a choppy episode", () => {
  // Degraded output that reaches 200ms of buffer latency mid-episode and then
  // stabilizes to a lower level must be reported at its worst, not its onset.
  const m = new PlayoutMonitor({}, { windowRecoveries: 3, windowMs: 1500, recoverSilenceMs: 2000, stallGapMs: 1e9, inputResyncDrops: 99, inputResyncWindowMs: 1500, inputResyncCooldownMs: 4000 });
  const word = (rec: number, bytes: number, t: number) => m.publish(levels({ recoveries: rec, queuedBytes: bytes }), t);
  // 2400 bytes -> 50ms, 4800 -> 100ms, 9600 -> 200ms of output latency.
  word(0, 0, 0);
  word(1, 2400, 50);
  word(2, 4800, 150);
  word(3, 9600, 250); // third recovery in-window -> onset, peak = 200ms
  assert.equal(m.snapshot().phase, "choppy");
  assert.equal(m.snapshot().peakQueuedMs, 200);
  word(3, 4800, 400); // latency settling but still elevated
  assert.equal(m.snapshot().peakQueuedMs, 200, "peak is the episode maximum, not the latest");
  word(3, 4800, 3000); // quiet past recoverSilenceMs -> recovered
  assert.equal(m.snapshot().phase, "healthy");
  assert.equal(m.snapshot().peakQueuedMs, 200);
});

test("a heartbeat gap past stallGapMs emits a factual audio-stall event", () => {
  // Simulates the audio stream (or the event loop feeding it) stopping its
  // ~20Hz level publishes for a visible interval without an explicit underrun.
  const stalls: Array<[number, number]> = [];
  const m = new PlayoutMonitor({ onAudioStall: (gap, q) => stalls.push([gap, q]) }, { windowRecoveries: 3, windowMs: 1500, recoverSilenceMs: 1500, stallGapMs: 100, inputResyncDrops: 99, inputResyncWindowMs: 1500, inputResyncCooldownMs: 4000 });
  m.publish(levels({ queuedBytes: 0 }), 0);
  m.publish(levels({ queuedBytes: 0 }), 30);
  m.publish(levels({ queuedBytes: 0 }), 60);
  assert.equal(stalls.length, 0, "normal ~20Hz cadence (30ms gaps) must not stall");
  m.publish(levels({ queuedBytes: 2400 }), 300); // 240ms gap > stallGapMs
  assert.deepEqual(stalls, [[240, 50]]);
  m.publish(levels({ queuedBytes: 2400 }), 320);
  assert.equal(stalls.length, 1, "a resumed regular cadence emits no second stall");
});