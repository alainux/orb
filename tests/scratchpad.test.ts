import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Scratchpad } from "../src/scratchpad.js";

test("scratchpad loads, edits, atomically saves, and stays ephemeral",async()=>{
  const root=await mkdtemp(join(tmpdir(),"orb-pad-"));
  await writeFile(join(root,"TODO.md"),"- first\n- second\n","utf8");
  const pad=new Scratchpad(root,{panelHeight:18,maxBytes:4096},false);
  await pad.load("TODO.md");
  assert.equal(pad.snapshot().title,"TODO.md");
  pad.append("- third");
  assert.match(pad.snapshot().content,/third/);
  const saved=await pad.save("notes/refined.md");
  assert.equal(await readFile(saved.path,"utf8"),"- first\n- second\n- third");
  assert.equal(pad.snapshot().dirty,false);
  pad.close(); assert.equal(pad.snapshot().open,false);
});

test("scratchpad is project-scoped unless explicitly permitted",async()=>{
  const root=await mkdtemp(join(tmpdir(),"orb-pad-root-"));
  const outside=await mkdtemp(join(tmpdir(),"orb-pad-out-"));
  await writeFile(join(outside,"x.md"),"outside","utf8");
  const restricted=new Scratchpad(root,{panelHeight:18,maxBytes:4096},false);
  await assert.rejects(()=>restricted.load(join(outside,"x.md")),/restricted to the Pi project/);
  const allowed=new Scratchpad(root,{panelHeight:18,maxBytes:4096},true);
  await allowed.load(join(outside,"x.md"));
  assert.equal(allowed.snapshot().content,"outside");
});

test("scratchpad enforces configured size limit",()=>{
  const pad=new Scratchpad(tmpdir(),{panelHeight:18,maxBytes:8},true);
  assert.throws(()=>pad.replace("123456789"),/exceeds 8 bytes/);
});
