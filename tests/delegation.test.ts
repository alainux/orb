import assert from "node:assert/strict";
import test from "node:test";
import { DelegatedWorkTracker, sendPiTask } from "../src/delegation.js";

test("delegated work tracker distinguishes user Pi activity from voice-delegated work",()=>{
  const tracker=new DelegatedWorkTracker();
  assert.equal(tracker.agentStarted(),"unrelated");
  tracker.delegated();
  assert.equal(tracker.agentStarted(),"delegated-start");
  assert.equal(tracker.agentEnded(),"delegated-finish");
  assert.equal(tracker.pendingCount,0);
  assert.equal(tracker.agentEnded(),"unrelated");
});

test("Pi tasks submit immediately when idle and queue when Pi is working",async()=>{
  const calls:any[]=[];const pi={sendUserMessage:(content:string,options?:any)=>{calls.push({content,options});}};
  assert.deepEqual(await sendPiTask(pi,{isIdle:()=>true},"explore"),{queued:false});
  assert.deepEqual(await sendPiTask(pi,{isIdle:()=>false},"fix tests"),{queued:true});
  assert.equal(calls[0].options,undefined);assert.deepEqual(calls[1].options,{deliverAs:"followUp"});
});
