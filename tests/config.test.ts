import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isHerdrSubAgent, loadVoiceConfig, resolveAutoStartVoice } from "../src/config.js";

async function withEnv(values:Record<string,string|undefined>,run:()=>Promise<void>):Promise<void>{
  const prev:Record<string,string|undefined>={};
  for(const[k,v]of Object.entries(values)){prev[k]=process.env[k];if(v===undefined)delete process.env[k];else process.env[k]=v;}
  try{await run();}finally{for(const[k,v]of Object.entries(prev)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}

test("selected provider validates only its own key",async()=>withEnv({GEMINI_API_KEY:undefined,OPENAI_API_KEY:"openai-test",ORB_CONFIG:undefined},async()=>{
  const config=await loadVoiceConfig("openai",tmpdir());assert.equal(config.provider,"openai");assert.equal(config.apiKey,"openai-test");
}));

test("JSON config controls UI, session and prompt file",async()=>{
  const root=await mkdtemp(join(tmpdir(),"orb-config-"));
  const prompt=join(root,"voice.md");const configFile=join(root,"config.json");
  await writeFile(prompt,"CUSTOM ORB PROMPT","utf8");
  await writeFile(configFile,JSON.stringify({provider:"gemini",voice:{temperature:0.31,promptFile:prompt},ui:{panelHeight:11,orbDensity:1.3,orbReactivity:0.35,orbBraille:true},session:{geminiSessionResumption:true,geminiContextCompression:true}}),"utf8");
  await withEnv({GEMINI_API_KEY:"test",ORB_CONFIG:configFile},async()=>{
    const config=await loadVoiceConfig(undefined,root);
    assert.equal(config.temperature,0.31);assert.equal(config.systemPrompt,"CUSTOM ORB PROMPT","a prompt file override replaces the default wholesale");assert.equal(config.panelHeight,11);assert.equal(config.orbDensity,1.3);assert.equal(config.orbReactivity,0.35);assert.equal(config.orbBraille,true);assert.equal(config.configFiles.includes(configFile),true);
  });
});

test("Gemini long-session protections are enabled by default",async()=>withEnv({GEMINI_API_KEY:"test",ORB_CONFIG:undefined,ORB_GEMINI_SESSION_RESUMPTION:undefined,ORB_GEMINI_CONTEXT_COMPRESSION:undefined},async()=>{
  const config=await loadVoiceConfig("gemini",tmpdir());assert.equal(config.geminiSessionResumption,true);assert.equal(config.geminiContextCompression,true);
}));

test("Braille rendering is the default orb style",async()=>withEnv({GEMINI_API_KEY:"test",ORB_CONFIG:undefined,ORB_BRAILLE:undefined,PI_VOICE_ORB_BRAILLE:undefined},async()=>{
  const config=await loadVoiceConfig("gemini",tmpdir());assert.equal(config.orbBraille,true);
  // Opting out still works, both via env and via config.
  await withEnv({GEMINI_API_KEY:"test",ORB_CONFIG:undefined,ORB_BRAILLE:"0",PI_VOICE_ORB_BRAILLE:undefined},async()=>{
    assert.equal((await loadVoiceConfig("gemini",tmpdir())).orbBraille,false);
  });
}));


test("Pi controls, audio recovery and scratchpad are configurable",async()=>{
  const root=await mkdtemp(join(tmpdir(),"orb-config-control-"));
  const configFile=join(root,"config.json");
  await writeFile(configFile,JSON.stringify({permissions:{cancelPi:true},audio:{bufferMs:180,maxBufferMs:520,recoveryStepMs:60,interruptionStormCount:4},scratchpad:{panelHeight:20,maxBytes:131072}}),"utf8");
  await withEnv({GEMINI_API_KEY:"test",ORB_CONFIG:configFile},async()=>{
    const config=await loadVoiceConfig("gemini",root);
    assert.equal(config.permissions.cancelPi,true);
    assert.equal(config.audio.bufferMs,180);assert.equal(config.audio.maxBufferMs,520);assert.equal(config.audio.recoveryStepMs,60);assert.equal(config.audio.interruptionStormCount,4);
    assert.equal(config.audio.bufferMs,180);assert.equal(config.audio.maxBufferMs,520);assert.equal(config.audio.recoveryStepMs,60);assert.equal(config.audio.interruptionStormCount,4);
    assert.equal(config.scratchpad.panelHeight,20);assert.equal(config.scratchpad.maxBytes,131072);
  });
});

test("missing selected provider key is rejected",async()=>{
  // Isolate the default config base so this never depends on a persisted key
  // a developer may have in their real ~/.config/orb/config.json.
  const xdg=await mkdtemp(join(tmpdir(),"orb-xdg-key-"));
  await withEnv({GEMINI_API_KEY:undefined,GOOGLE_API_KEY:undefined,OPENAI_API_KEY:undefined,ORB_CONFIG:undefined,XDG_CONFIG_HOME:xdg},async()=>{await assert.rejects(()=>loadVoiceConfig("gemini",tmpdir()),/GEMINI_API_KEY/);});
});

test("a UI-provided API key satisfies loadVoiceConfig without env vars",async()=>withEnv({GEMINI_API_KEY:undefined,GOOGLE_API_KEY:undefined,OPENAI_API_KEY:undefined,ORB_CONFIG:undefined},async()=>{
  const config=await loadVoiceConfig("gemini",tmpdir(),{apiKey:"ui-collected-key"});
  assert.equal(config.provider,"gemini");assert.equal(config.apiKey,"ui-collected-key");
  const openai=await loadVoiceConfig("openai",tmpdir(),{apiKey:"sk-ui-collected"});
  assert.equal(openai.provider,"openai");assert.equal(openai.apiKey,"sk-ui-collected");
}));

test("autoStartVoice defaults to true and is exposed by the config loader",async()=>withEnv({GEMINI_API_KEY:"test",ORB_CONFIG:undefined,ORB_AUTO_START:undefined},async()=>{
  const config=await loadVoiceConfig("gemini",tmpdir());
  assert.equal(config.autoStartVoice,true);
  assert.equal(await resolveAutoStartVoice(tmpdir()),true);
}));

test("autoStartVoice=false in config.json opts out",async()=>{
  const root=await mkdtemp(join(tmpdir(),"orb-autostart-"));
  const configFile=join(root,"config.json");
  await writeFile(configFile,JSON.stringify({autoStartVoice:false}),"utf8");
  await withEnv({GEMINI_API_KEY:"test",ORB_CONFIG:configFile,ORB_AUTO_START:undefined},async()=>{
    assert.equal((await loadVoiceConfig("gemini",root)).autoStartVoice,false);
    assert.equal(await resolveAutoStartVoice(root),false);
  });
});

test("ORB_AUTO_START env overrides config.json autoStartVoice",async()=>{
  const root=await mkdtemp(join(tmpdir(),"orb-auto-start-env-"));
  const configFile=join(root,"config.json");
  await writeFile(configFile,JSON.stringify({autoStartVoice:true}),"utf8");
  await withEnv({GEMINI_API_KEY:"test",ORB_CONFIG:configFile,ORB_AUTO_START:"false"},async()=>{
    assert.equal(await resolveAutoStartVoice(root),false);
    assert.equal((await loadVoiceConfig("gemini",root)).autoStartVoice,false);
  });
});

test("isHerdrSubAgent: top-level bash has no signal; any Herdr pane counts as a sub-agent",async()=>{
  // A top-level instance launched directly from bash inherits no HERDR_* and no
  // PI_SUBAGENT_*.
  await withEnv({PI_SUBAGENT_ID:undefined,PI_SUBAGENT_NAME:undefined,PI_SUBAGENT_SESSION:undefined,PI_SUBAGENT_SURFACE:undefined,HERDR_ENV:undefined},async()=>{
    assert.equal(isHerdrSubAgent(),false,"a top-level process launched from bash is not a sub-agent");
  });
  // Every process in a Herdr pane gets HERDR_ENV=1, including workers spawned via
  // the Factory's `herdr agent start --kind pi` (no PI_SUBAGENT_*).
  await withEnv({PI_SUBAGENT_ID:undefined,PI_SUBAGENT_NAME:undefined,PI_SUBAGENT_SESSION:undefined,PI_SUBAGENT_SURFACE:undefined,HERDR_ENV:"1"},async()=>{
    assert.equal(isHerdrSubAgent(),true,"HERDR_ENV=1 marks a sub-agent tab");
  });
  // pi-herdr-subagents adds PI_SUBAGENT_ID on top; also true.
  await withEnv({HERDR_ENV:"1",PI_SUBAGENT_ID:"abc",PI_SUBAGENT_NAME:"Scout: Auth",PI_SUBAGENT_SESSION:"child.jsonl",PI_SUBAGENT_SURFACE:"w1:p1"},async()=>{
    assert.equal(isHerdrSubAgent(),true);
  });
});

test("top-level instance launched directly from bash keeps voice auto-start",async()=>withEnv({GEMINI_API_KEY:"test",ORB_CONFIG:undefined,ORB_AUTO_START:undefined,HERDR_ENV:undefined,PI_SUBAGENT_ID:undefined},async()=>{
  assert.equal(await resolveAutoStartVoice(tmpdir()),true);
  assert.equal((await loadVoiceConfig("gemini",tmpdir())).autoStartVoice,true);
}));

test("autoStartVoice is off by default in a Herdr sub-agent tab",async()=>withEnv({GEMINI_API_KEY:"test",ORB_CONFIG:undefined,ORB_AUTO_START:undefined,HERDR_ENV:"1",PI_SUBAGENT_ID:"1",PI_SUBAGENT_NAME:"worker"},async()=>{
  assert.equal((await loadVoiceConfig("gemini",tmpdir())).autoStartVoice,false);
  assert.equal(await resolveAutoStartVoice(tmpdir()),false);
}));

test("ORB_AUTO_START=true still opts a sub-agent tab back in",async()=>withEnv({GEMINI_API_KEY:"test",ORB_CONFIG:undefined,ORB_AUTO_START:"true",HERDR_ENV:"1",PI_SUBAGENT_ID:"1"},async()=>{
  assert.equal(await resolveAutoStartVoice(tmpdir()),true);
}));

test("thinkingDisplay defaults to minimized and honors ui.thinkingDisplay + env override",async()=>{
  const root=await mkdtemp(join(tmpdir(),"orb-config-thinkdisplay-"));
  const configFile=join(root,"config.json");
  await writeFile(configFile,JSON.stringify({ui:{thinkingDisplay:"full"}}),"utf8");
  // JSON preference wins by default.
  await withEnv({GEMINI_API_KEY:"test",ORB_CONFIG:configFile,ORB_THINKING_DISPLAY:undefined},async()=>{
    assert.equal((await loadVoiceConfig("gemini",root)).thinkingDisplay,"full");
  });
  // Env var overrides the JSON preference.
  await withEnv({GEMINI_API_KEY:"test",ORB_CONFIG:configFile,ORB_THINKING_DISPLAY:"hidden"},async()=>{
    assert.equal((await loadVoiceConfig("gemini",root)).thinkingDisplay,"hidden");
  });
  // With no preference anywhere the default is "minimized".
  await withEnv({GEMINI_API_KEY:"test",ORB_CONFIG:undefined,ORB_THINKING_DISPLAY:undefined},async()=>{
    assert.equal((await loadVoiceConfig("gemini",tmpdir())).thinkingDisplay,"minimized");
  });
  // An invalid value is rejected.
  await withEnv({GEMINI_API_KEY:"test",ORB_CONFIG:undefined,ORB_THINKING_DISPLAY:"banana"},async()=>{
    await assert.rejects(()=>loadVoiceConfig("gemini",tmpdir()),/thinkingDisplay/);
  });
});

test("live preference overrides never write the canonical config file (read-only input)", async()=>{
  const root=await mkdtemp(join(tmpdir(),"orb-config-readonly-"));
  const configFile=join(root,"config.json");
  // A canonical config authored by the user.
  await writeFile(configFile,JSON.stringify({ui:{thinkingDisplay:"full"}}),"utf8");
  await withEnv({GEMINI_API_KEY:"test",ORB_CONFIG:configFile,ORB_THINKING_DISPLAY:undefined},async()=>{
    assert.equal((await loadVoiceConfig("gemini",root)).thinkingDisplay,"full");
  });
  // Loading must never rewrite the file: runtime prefs are session-entried, so
  // the canonical config stays exactly as the user wrote it.
  const onDisk=JSON.parse(await readFile(configFile,"utf8"));
  assert.deepEqual(onDisk,{ui:{thinkingDisplay:"full"}},"loadVoiceConfig never writes back to the canonical input");
});

test("geminiThinkingBudget defaults to 1024 (minimal real thinking, not none)",async()=>{
  const root=await mkdtemp(join(tmpdir(),"orb-config-budget-default-"));
  // Isolate from any ambient user config by pointing XDG_CONFIG_HOME into a
  // fresh dir and clearing the env override so the code default applies.
  await withEnv({GEMINI_API_KEY:"test",ORB_CONFIG:undefined,ORB_GEMINI_THINKING_BUDGET:undefined,XDG_CONFIG_HOME:join(root,"xdg")},async()=>{
    const config=await loadVoiceConfig("gemini",root);
    assert.equal(config.geminiThinkingBudget,1024,"a minimal but non-zero thinking budget is enabled by default");

    // And an explicit env override still works with the same floor.
    await withEnv({GEMINI_API_KEY:"test",ORB_CONFIG:undefined,ORB_GEMINI_THINKING_BUDGET:"-1",XDG_CONFIG_HOME:join(root,"xdg")},async()=>{
      assert.equal((await loadVoiceConfig("gemini",root)).geminiThinkingBudget,-1);
    });
  });
});

test("loadVoiceConfig falls back to a persisted provider API key",async()=>{
  const root=await mkdtemp(join(tmpdir(),"orb-persist-"));
  const configFile=join(root,"config.json");
  await writeFile(configFile,JSON.stringify({gemini:{apiKey:"persisted-key"}}),"utf8");
  await withEnv({GEMINI_API_KEY:undefined,GOOGLE_API_KEY:undefined,OPENAI_API_KEY:undefined,ORB_CONFIG:configFile},async()=>{
    assert.equal((await loadVoiceConfig("gemini",root)).apiKey,"persisted-key");
  });
});

test("an env key wins over a persisted provider key",async()=>{
  const root=await mkdtemp(join(tmpdir(),"orb-persist-env-"));
  const configFile=join(root,"config.json");
  await writeFile(configFile,JSON.stringify({gemini:{apiKey:"persisted-key"}}),"utf8");
  await withEnv({GEMINI_API_KEY:"env-key",ORB_CONFIG:configFile},async()=>{
    assert.equal((await loadVoiceConfig("gemini",root)).apiKey,"env-key");
  });
});
