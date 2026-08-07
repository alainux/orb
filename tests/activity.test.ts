import assert from "node:assert/strict";
import test from "node:test";
import { ActivityFeed } from "../src/activity.js";

test("activity feed keeps transcripts as chronological turns around tool calls",()=>{
  const feed=new ActivityFeed();
  feed.transcript("you","hello",false);
  feed.transcript("you","hello world",false);
  assert.equal(feed.snapshot().length,1);
  feed.transcript("you","hello world",true);
  feed.add("voice-tool","→ delegate to Pi · explore repo");
  feed.transcript("voice","One sec.",true);
  assert.deepEqual(feed.snapshot().map(x=>x.kind),["you","voice-tool","voice"]);
});

test("late finals can never merge two conversational turns",()=>{
  const feed=new ActivityFeed();
  feed.transcript("voice","First answer",false);
  feed.transcript("you","Wait, do this instead",false);
  // A late provider final from the interrupted Orb turn becomes its own entry,
  // not an append to the current human turn.
  feed.transcript("voice","First answer",true);
  feed.add("voice-tool","→ Pi cancel");
  feed.transcript("voice","Got it.",true);
  const rows=feed.snapshot();
  assert.deepEqual(rows.map(x=>x.kind),["voice","you","voice","voice-tool","voice"]);
  assert.equal(rows[1]?.text,"Wait, do this instead");
  assert.equal(rows.at(-1)?.text,"Got it.");
});
