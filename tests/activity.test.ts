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
  // A late provider final repeating the interrupted turn exactly is a replay
  // of the barge-in commit above; the feed must not render the message twice.
  feed.transcript("voice","First answer",true);
  feed.add("voice-tool","→ Pi cancel");
  feed.transcript("voice","Got it.",true);
  const rows=feed.snapshot();
  assert.deepEqual(rows.map(x=>x.kind),["voice","you","voice-tool","voice"]);
  assert.equal(rows[1]?.text,"Wait, do this instead");
  assert.equal(rows[0]?.text,"First answer");
  assert.equal(rows.at(-1)?.text,"Got it.");
});

test("an exact replayed final is dropped, not duplicated",()=>{
  const feed=new ActivityFeed();
  // Provider flushes the interrupted turn on barge-in…
  feed.transcript("voice","One sec",false);
  feed.transcript("you","No, cancel",false);
  feed.transcript("voice","One sec",true); // barge-in commit (final)
  // …then the same provider event is delivered again (late done/replay).
  feed.transcript("voice","One sec",true);
  feed.transcript("voice","One sec",true);
  assert.equal(feed.snapshot().length,2);
  assert.deepEqual(feed.snapshot().map(x=>x.kind),["voice","you"]);
});

test("user-side replays are deduplicated the same way",()=>{
  const feed=new ActivityFeed();
  feed.transcript("you","fix the build",false);
  feed.transcript("voice","On it",false); // barge-in commits the user partial
  feed.transcript("you","fix the build",true); // late final after reconnect replay
  assert.deepEqual(feed.snapshot().map(x=>x.kind),["you","voice"]);
  assert.equal(feed.snapshot().filter(x=>x.text==="fix the build").length,1);
});

test("identical text after a finalized reply is a genuine new turn",()=>{
  const feed=new ActivityFeed();
  feed.transcript("you","yes",true);
  feed.transcript("voice","ok",true);
  feed.transcript("you","yes",true); // conversation moved on — keep it
  assert.deepEqual(feed.snapshot().map(x=>x.text),["yes","ok","yes"]);
});

test("a late final with different text still becomes its own entry",()=>{
  const feed=new ActivityFeed();
  feed.transcript("voice","First answer",false);
  feed.transcript("you","Wait, do this instead",false);
  // The barge-in commit happened with an older fragment; the real final is a
  // superset, so it is a distinct entry — not a replay of the committed text.
  feed.transcript("voice","First answer, revised",true);
  const rows=feed.snapshot();
  assert.deepEqual(rows.map(x=>x.kind),["voice","you","voice"]);
  assert.equal(rows[2]?.text,"First answer, revised");
});
