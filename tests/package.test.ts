import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manifest is a distributable Orb Pi package",async()=>{
  const manifest=JSON.parse(await readFile("package.json","utf8"));
  assert.equal(manifest.name,"@alainux/orb");
  assert.equal(manifest.repository.url,"git+https://github.com/alainux/orb.git");
  assert.equal(manifest.bin.orb,"./bin/orb.mjs");
  assert.ok(manifest.keywords.includes("pi-package"));
  assert.deepEqual(manifest.pi.extensions,["./extensions/voice.ts"]);
  for(const dep of ["@google/genai","ws"])assert.ok(manifest.dependencies[dep]);
  assert.ok(manifest.files.includes("audio-helper"));assert.ok(manifest.files.includes("config"));assert.ok(manifest.files.includes("prompts"));
});

test("voice has orchestration-only tooling and never configures or mirrors Pi",async()=>{
  const files=await Promise.all(["extensions/voice.ts","src/controller.ts","src/providers/gemini.ts","src/providers/openai.ts","src/pi-control.ts"].map(path=>readFile(path,"utf8")));
  const joined=files.join("\n");
  assert.match(joined,/run_pi_task/);assert.match(joined,/observe_pi/);assert.match(joined,/control_pi/);assert.match(joined,/scratchpad/);
  assert.match(joined,/permissions\.cancelPi/);assert.match(joined,/"cancel"/);
  assert.doesNotMatch(joined,/permissions\.setModel/);assert.doesNotMatch(joined,/permissions\.setThinking/);
  assert.doesNotMatch(joined,/permissions\.setTools/);assert.doesNotMatch(joined,/permissions\.shell/);
  assert.doesNotMatch(joined,/set_voice/);
  assert.doesNotMatch(joined,/update_pi_prompt|submit_pi_prompt|base_revision|setEditorText|getEditorText/);
});

test("developer audio build resolves module dependencies without manual go get",async()=>{
  const script=await readFile("scripts/build-audio-helper.mjs","utf8");
  assert.match(script,/"build", "-mod=mod"/);
  assert.doesNotMatch(script,/spawn\(go, \["get"/);
});

test("cross-platform install surfaces and developer docs are shipped",async()=>{
  for(const path of ["scripts/install.sh","scripts/install.ps1","docs/ARCHITECTURE.md","docs/CONFIGURATION.md","docs/RELEASING.md","CONTRIBUTING.md","CODE_OF_CONDUCT.md"]){const text=await readFile(path,"utf8");assert.ok(text.length>80,path);}
});
