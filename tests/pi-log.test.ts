import assert from "node:assert/strict";
import test from "node:test";
import { PiLogMirror } from "../src/pi-log.js";

test("Pi log exposes visible text and tools but not thinking",()=>{const m=new PiLogMirror();m.record("agent_start",{});m.record("message_update",{assistantMessageEvent:{type:"thinking_delta",delta:"secret"}});m.record("message_update",{assistantMessageEvent:{type:"text_delta",delta:"Working"}});m.record("tool_execution_start",{toolName:"read"});const s=m.snapshot({sessionManager:{getBranch:()=>[{type:"message",message:{role:"assistant",content:[{type:"thinking",thinking:"hidden"},{type:"text",text:"Found it"}]}}]}},10);assert.equal(s.status,"working");assert.match(s.text,/Found it|Working/);assert.doesNotMatch(s.text,/secret|hidden/);});

test("observe waits until Pi settles",async()=>{const m=new PiLogMirror();m.record("agent_start",{});const after=m.revision;const waiting=m.observe(after,"settled",500);setTimeout(()=>{m.record("message_end",{message:{role:"assistant",content:[{type:"text",text:"Tests passed"}]}});m.record("agent_end",{});},10);await waiting;const s=m.snapshot(undefined,10);assert.equal(s.status,"idle");assert.ok(s.revision>after);assert.match(s.text,/Tests passed/);});

test("observe can return on activity",async()=>{const m=new PiLogMirror();m.record("agent_start",{});const after=m.revision;const waiting=m.observe(after,"activity",500);setTimeout(()=>m.record("tool_execution_start",{toolName:"test"}),10);await waiting;assert.ok(m.revision>after);assert.equal(m.agentStatus,"working");});


test("Pi log observes direct user ! commands and model switches",()=>{const m=new PiLogMirror();m.record("user_bash",{command:"git status",excludeFromContext:false});m.record("model_select",{model:{provider:"anthropic",id:"claude-sonnet-4"}});const s=m.snapshot(undefined,10);assert.match(s.text,/user bash !.*git status/);assert.match(s.text,/model.*claude-sonnet-4/);});


test("Pi session branch exposes normal ! command output but respects !! exclusion",()=>{const m=new PiLogMirror();const ctx={sessionManager:{getBranch:()=>[
  {type:"message",message:{role:"bashExecution",command:"git status",output:"clean",exitCode:0,cancelled:false,excludeFromContext:false}},
  {type:"message",message:{role:"bashExecution",command:"secret",output:"hidden",exitCode:0,cancelled:false,excludeFromContext:true}},
]}};const s=m.snapshot(ctx,10);assert.match(s.text,/git status/);assert.match(s.text,/clean/);assert.doesNotMatch(s.text,/secret|hidden/);});

test("Pi visible activity is forwarded durably but hidden thinking is not",()=>{
  const got:Array<{kind:string;text:string}> = [];
  const m = new PiLogMirror((e) => got.push(e));
  m.record("agent_start",{});
  m.record("message_update",{assistantMessageEvent:{type:"thinking_delta",delta:"secret-plan"}});
  m.record("message_end",{message:{role:"assistant",content:[{type:"thinking",thinking:"hidden"},{type:"text",text:"Found it"}]}});
  m.record("tool_execution_start",{toolName:"read"});
  m.record("tool_execution_end",{toolName:"read"});
  m.record("user_bash",{command:"git status",excludeFromContext:false});
  const all = got.map(x => x.text).join(" | ");
  assert.match(all,/Pi started working/);
  assert.match(all,/Found it/);
  assert.match(all,/read/);
  assert.match(all,/git status/);
  // thinking delta & hidden thinking never forwarded
  assert.doesNotMatch(all,/secret-plan|hidden/i);
  // no live text_delta notes (only finalized assistant text is forwarded)
  assert.equal(got.filter(e => e.text.includes("secret-plan")).length, 0);
});

test("excluded !! bash is not forwarded for durable logging",()=>{
  const got:Array<{kind:string;text:string}> = [];
  const m = new PiLogMirror((e) => got.push(e));
  m.record("user_bash",{command:"rm -rf secret",excludeFromContext:true});
  assert.equal(got.some(e => e.text.includes("secret")), false);
});
