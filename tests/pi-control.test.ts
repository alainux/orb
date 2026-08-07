import assert from "node:assert/strict";
import test from "node:test";
import { PiControl } from "../src/pi-control.js";
import type { OrbPermissions } from "../src/types.js";

const allowed:OrbPermissions={cancelPi:true,setModel:true,setThinking:true,setTools:true,shell:true,scratchpadRead:true,scratchpadWrite:true,scratchpadOutsideProject:false};

function fixture(){
  let aborted=0; let selected:any; let thinking="medium"; let shell:any;
  const models=[{provider:"anthropic",id:"claude-sonnet-4",name:"Sonnet"},{provider:"openai",id:"gpt-5",name:"GPT 5"}];
  const pi:any={
    activeTools:["read","bash","edit","write"],
    setModel:async(model:any)=>{selected=model;return true;},
    setThinkingLevel:(level:string)=>{thinking=level;},getThinkingLevel:()=>thinking,
    getActiveTools(){return [...this.activeTools];},setActiveTools(tools:string[]){this.activeTools=[...tools];},
    exec:async(command:string,args:string[],options:any)=>{shell={command,args,options};return{code:0,killed:false,stdout:"ok",stderr:""};},
  };
  const ctx:any={cwd:"/project",isIdle:()=>false,abort:()=>{aborted++;},model:models[0],modelRegistry:{getAvailable:async()=>models,find:(provider:string,id:string)=>models.find(m=>m.provider===provider&&m.id===id)}};
  return{pi,ctx,get:()=>({aborted,selected,thinking,shell})};
}

test("voice can cancel Pi, switch model/thinking, and execute permitted shell controls",async()=>{
  const f=fixture(); const control=new PiControl(f.pi,allowed);
  assert.equal((await control.execute("cancel",{},f.ctx)).ok,true);assert.equal(f.get().aborted,1);
  const models=await control.execute("list_models",{},f.ctx);assert.equal((models.models as any[]).length,2);
  assert.equal((await control.execute("set_model",{model:"gpt-5"},f.ctx)).ok,true);assert.equal(f.get().selected.id,"gpt-5");
  assert.equal((await control.execute("set_thinking",{level:"high"},f.ctx)).ok,true);assert.equal(f.get().thinking,"high");
  assert.equal((await control.execute("set_tools",{tools:["read","bash"]},f.ctx)).ok,true);assert.deepEqual(f.pi.getActiveTools(),["read","bash"]);
  const shell=await control.execute("shell",{command:"git status"},f.ctx);assert.equal(shell.ok,true);assert.match(f.get().shell.args.join(" "),/git status/);
});

test("Pi control permissions are enforced independently",async()=>{
  const f=fixture(); const control=new PiControl(f.pi,{...allowed,shell:false,cancelPi:false});
  assert.match(String((await control.execute("cancel",{},f.ctx)).error),/cancelPi/);
  assert.match(String((await control.execute("shell",{command:"pwd"},f.ctx)).error),/shell/);
});
