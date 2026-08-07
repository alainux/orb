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

test("voice layer exposes no arbitrary execution tool and no editor-mirroring tool",async()=>{
  const files=await Promise.all(["extensions/voice.ts","src/controller.ts","src/providers/gemini.ts","src/providers/openai.ts","src/delegation.ts"].map(path=>readFile(path,"utf8")));
  const joined=files.join("\n");
  assert.equal(/execFile\(|spawn\(/.test(joined),false);
  assert.match(joined,/run_pi_task/);assert.match(joined,/sendUserMessage/);assert.match(joined,/observe_pi/);
  assert.doesNotMatch(joined,/update_pi_prompt|submit_pi_prompt|base_revision|setEditorText|getEditorText/);
});

test("cross-platform install surfaces and developer docs are shipped",async()=>{
  for(const path of ["scripts/install.sh","scripts/install.ps1","docs/ARCHITECTURE.md","docs/CONFIGURATION.md","docs/RELEASING.md","CONTRIBUTING.md","CODE_OF_CONDUCT.md"]){const text=await readFile(path,"utf8");assert.ok(text.length>80,path);}
});
