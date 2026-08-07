import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadVoiceConfig } from "../src/config.js";

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
  await writeFile(configFile,JSON.stringify({provider:"gemini",voice:{temperature:0.31,promptFile:prompt,greeting:false},ui:{panelHeight:11,orbDensity:1.3,orbReactivity:0.35,orbBraille:true},session:{geminiSessionResumption:true,geminiContextCompression:true}}),"utf8");
  await withEnv({GEMINI_API_KEY:"test",ORB_CONFIG:configFile},async()=>{
    const config=await loadVoiceConfig(undefined,root);
    assert.equal(config.temperature,0.31);assert.equal(config.systemPrompt,"CUSTOM ORB PROMPT");assert.equal(config.panelHeight,11);assert.equal(config.orbDensity,1.3);assert.equal(config.orbReactivity,0.35);assert.equal(config.orbBraille,true);assert.equal(config.greetingEnabled,false);assert.equal(config.configFiles.includes(configFile),true);
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
  await writeFile(configFile,JSON.stringify({permissions:{shell:false,cancelPi:true,setModel:false,setTools:false},audio:{bufferMs:180,maxBufferMs:520,recoveryStepMs:60,interruptionStormCount:4},scratchpad:{panelHeight:20,maxBytes:131072}}),"utf8");
  await withEnv({GEMINI_API_KEY:"test",ORB_CONFIG:configFile},async()=>{
    const config=await loadVoiceConfig("gemini",root);
    assert.equal(config.permissions.shell,false);assert.equal(config.permissions.cancelPi,true);assert.equal(config.permissions.setModel,false);assert.equal(config.permissions.setTools,false);
    assert.equal(config.audio.bufferMs,180);assert.equal(config.audio.maxBufferMs,520);assert.equal(config.audio.recoveryStepMs,60);assert.equal(config.audio.interruptionStormCount,4);
    assert.equal(config.scratchpad.panelHeight,20);assert.equal(config.scratchpad.maxBytes,131072);
  });
});

test("missing selected provider key is rejected",async()=>withEnv({GEMINI_API_KEY:undefined,GOOGLE_API_KEY:undefined,ORB_CONFIG:undefined},async()=>{await assert.rejects(()=>loadVoiceConfig("gemini",tmpdir()),/GEMINI_API_KEY/);}));
