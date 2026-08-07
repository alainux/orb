import assert from "node:assert/strict";
import test from "node:test";
import { ActivityFeed } from "../src/activity.js";

test("activity feed keeps voice transcripts and voice tool calls only",()=>{
  const feed=new ActivityFeed();
  feed.transcript("you","hello",false);
  feed.transcript("you","hello world",false);
  assert.equal(feed.snapshot().length,1);
  feed.transcript("you","hello world",true);
  feed.add("voice-tool","→ delegate to Pi · explore repo");
  feed.transcript("voice","One sec.",true);
  assert.deepEqual(feed.snapshot().map(x=>x.kind),["you","voice-tool","voice"]);
});
