import assert from "node:assert/strict";
import test from "node:test";
import { AudioFrameDecoder, AudioMessage, encodeAudioFrame } from "../src/audio/protocol.js";
import { PcmInputAdapter } from "../src/audio/input-adapter.js";

test("audio helper framing survives arbitrary stream boundaries", () => {
  const decoder = new AudioFrameDecoder();
  const a = encodeAudioFrame(AudioMessage.Capture, Buffer.from([1,2,3]));
  const b = encodeAudioFrame(AudioMessage.Levels, Buffer.alloc(28, 7));
  const all = Buffer.concat([a,b]);
  assert.equal(decoder.push(all.subarray(0,4)).length,0);
  const mid = decoder.push(all.subarray(4,11));
  assert.equal(mid.length,1); assert.equal(mid[0]?.type,AudioMessage.Capture); assert.deepEqual([...mid[0]!.payload],[1,2,3]);
  const tail = decoder.push(all.subarray(11)); assert.equal(tail.length,1); assert.equal(tail[0]?.type,AudioMessage.Levels);
});

test("24 kHz capture is chunked into exact realtime provider frames", () => {
  const adapter = new PcmInputAdapter(24_000);
  const out = adapter.push(Buffer.alloc(24_000 * 2 / 10, 1)); // 100ms
  assert.equal(out.length,5); for(const chunk of out) assert.equal(chunk.length,960);
});

test("24 to 16 kHz conversion is stable across arbitrary capture chunks", () => {
  const whole = Buffer.alloc(2400);
  for(let i=0;i<whole.length;i+=2) whole.writeInt16LE((i/2)%30000,i);
  const one = new PcmInputAdapter(16_000).push(whole);
  const splitAdapter = new PcmInputAdapter(16_000);
  const split = [...splitAdapter.push(whole.subarray(0,713)),...splitAdapter.push(whole.subarray(713,1555)),...splitAdapter.push(whole.subarray(1555))];
  assert.deepEqual(Buffer.concat(split),Buffer.concat(one));
  for(const chunk of split) assert.equal(chunk.length,640);
});


test("playback end has a distinct protocol frame for natural response tails",()=>{
  const decoder=new AudioFrameDecoder();
  const [frame]=decoder.push(encodeAudioFrame(AudioMessage.PlaybackEnd));
  assert.equal(frame?.type,AudioMessage.PlaybackEnd);assert.equal(frame?.payload.length,0);
});
