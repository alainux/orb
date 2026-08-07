import type { Component, TUI } from "@earendil-works/pi-tui";
import type { ActivityEntry } from "./activity.js";
import { OrbMotion, OrbRenderer, rasterAt, type OrbFrame } from "./orb.js";
import type { VoiceViewState } from "./types.js";

type ThemeLike = { fg(name:"toolTitle"|"accent"|"success"|"error"|"warning"|"muted"|"dim", text:string):string };
interface WidgetOptions { orbAspect:number; orbDensity:number; panelHeight:number; activityLines:number; scratchpadPanelHeight:number }

export class VoiceWidget implements Component {
  private readonly motion = new OrbMotion();
  private readonly renderer: OrbRenderer;
  private frame: OrbFrame = { userEnergy:0, agentEnergy:0, energy:0, peak:0, phaseA:0, phaseB:0, source:"idle" };

  constructor(private readonly tui:TUI, private readonly theme:ThemeLike, private readonly getState:()=>VoiceViewState, private readonly options:WidgetOptions) {
    this.renderer = new OrbRenderer(options.orbDensity);
  }
  tick(nowMs=Date.now()):void { const state=this.getState(); this.frame=this.motion.step(nowMs,state.inputRms,state.outputRms,state.outputRms>0.015); this.tui.requestRender(); }
  invalidate():void { this.tui.requestRender(); }
  render(width:number):string[] { try { return this.renderFrame(width); } catch(error) { return [this.theme.fg("error",` Orb render error: ${error instanceof Error?error.message:String(error)}`)]; } }

  private renderFrame(width:number):string[] {
    const state=this.getState();
    if(width<54)return this.renderCompact(width,state);
    const requestedHeight=state.scratchpad.open?this.options.scratchpadPanelHeight:this.options.panelHeight;
    const height=Math.max(8,Math.min(32,requestedHeight));
    const leftWidth=Math.min(39,Math.max(25,Math.floor(width*0.31)));
    const gap=2;
    const rightWidth=Math.max(20,width-leftWidth-gap);
    const bodyHeight=Math.max(5,height-3);
    const raster=this.renderer.render(leftWidth,bodyHeight,this.options.orbAspect,this.frame);
    const left:string[]=[];
    for(let y=0;y<raster.height;y++){
      let line="";
      for(let x=0;x<raster.width;x++){
        const cell=rasterAt(raster,x,y);
        line+=cell.glyph?this.colorCell(cell.glyph,cell.shade,cell.layer):" ";
      }
      left.push(line);
    }
    const rightLines=state.scratchpad.open
      ? this.renderScratchpad(state,rightWidth,bodyHeight)
      : this.renderActivity(state.activity,rightWidth,Math.min(bodyHeight,this.options.activityLines));
    const title=this.theme.fg("accent"," ORB ")+this.theme.fg("dim",`· ${state.status} · Pi ${state.piAgentStatus}`);
    const lines=[title+this.theme.fg("dim","─".repeat(Math.max(0,width-stripAnsi(title).length)))];
    const body=Math.max(left.length,rightLines.length);
    for(let i=0;i<body;i++)lines.push(`${padVisible(left[i]??"",leftWidth)}${" ".repeat(gap)}${rightLines[i]??""}`);
    const sourceLabel=this.frame.source==="agent"?"ORB":this.frame.source.toUpperCase();
    const meters=`YOU ${bar(this.frame.userEnergy,8)}  ORB ${bar(this.frame.agentEnergy,8)}  ${sourceLabel}  buffer ${state.audioQueuedMs}ms · recoveries ${state.audioRecoveries}`;
    lines.push(this.theme.fg("dim",truncatePlain(meters,width)));
    lines.push(this.theme.fg("dim","─".repeat(width)));
    return lines;
  }

  private renderScratchpad(state:VoiceViewState,width:number,height:number):string[] {
    const lines:string[]=[];
    const dirty=state.scratchpad.dirty?" · modified":"";
    lines.push(this.theme.fg("accent",truncatePlain(`SCRATCHPAD · ${state.scratchpad.title}${dirty}`,width)));
    const logBudget=Math.min(4,Math.max(2,Math.floor(height*0.28)));
    const contentBudget=Math.max(2,height-logBudget-2);
    const contentLines=wrapPreservingLines(state.scratchpad.content,width);
    if(!contentLines.length) lines.push(this.theme.fg("dim","(empty — keep talking, load a file, or edit with /voice scratchpad edit)"));
    else for(const line of contentLines.slice(-contentBudget)) lines.push(this.theme.fg("muted",line));
    while(lines.length<contentBudget+1)lines.push("");
    lines.push(this.theme.fg("dim","─".repeat(Math.max(1,width))));
    const activity=this.renderActivity(state.activity,width,logBudget);
    lines.push(...activity);
    return lines.slice(0,height);
  }

  private renderActivity(entries:ActivityEntry[],width:number,maxLines:number):string[] {
    const rendered:string[]=[];
    const recent=entries.slice(-20);
    recent.forEach((entry,entryIndex)=>{
      const {label,color}=styleFor(entry.kind);
      const prefix=`${label} `;
      const chunks=wrap(entry.text,Math.max(8,width-prefix.length));
      chunks.forEach((chunk,index)=>rendered.push(index===0
        ? this.theme.fg(color,prefix)+this.theme.fg(entry.kind==="error"?"error":"muted",chunk)
        : this.theme.fg("dim"," ".repeat(prefix.length))+this.theme.fg("muted",chunk)));
      if(entryIndex<recent.length-1) rendered.push("");
    });
    if(!rendered.length)rendered.push(this.theme.fg("dim","Listening…"));
    return rendered.slice(-maxLines);
  }

  private renderCompact(width:number,state:VoiceViewState):string[] {
    if(state.scratchpad.open){
      const lines=[this.theme.fg("accent",truncatePlain(`ORB · SCRATCHPAD · ${state.scratchpad.title}`,width))];
      for(const line of wrapPreservingLines(state.scratchpad.content,width).slice(-Math.max(3,this.options.panelHeight-2))) lines.push(this.theme.fg("muted",line));
      return lines;
    }
    const h=Math.max(4,Math.min(6,this.options.panelHeight-3));
    const raster=this.renderer.render(width,h,this.options.orbAspect,this.frame);
    const lines=[this.theme.fg("accent",`ORB · ${state.status}`)];
    for(let y=0;y<raster.height;y++){
      let line="";
      for(let x=0;x<raster.width;x++){
        const c=rasterAt(raster,x,y);
        line+=c.glyph?this.colorCell(c.glyph,c.shade,c.layer):" ";
      }
      lines.push(line);
    }
    const last=state.activity.at(-1);
    if(last)lines.push(this.theme.fg(styleFor(last.kind).color,truncatePlain(`${styleFor(last.kind).label} ${last.text}`,width)));
    return lines;
  }

  private colorCell(glyph:string,shade:number,layer:string):string {
    if(layer==="filament")return this.theme.fg(shade>0.5?"toolTitle":"accent",glyph);
    if(layer==="mistA")return this.theme.fg(shade>0.48?"toolTitle":"muted",glyph);
    if(layer==="mistB")return this.theme.fg(shade>0.44?"accent":"muted",glyph);
    if(layer==="mistC")return this.theme.fg(shade>0.5?"success":shade>0.3?"muted":"dim",glyph);
    return this.theme.fg(shade>0.5?"muted":"dim",glyph);
  }
}

function styleFor(kind:ActivityEntry["kind"]):{label:string;color:"toolTitle"|"accent"|"success"|"error"|"warning"|"muted"|"dim"}{
  switch(kind){
    case"you":return{label:"YOU",color:"accent"};
    case"voice":return{label:"ORB",color:"toolTitle"};
    case"voice-tool":return{label:"ORB›",color:"warning"};
    case"error":return{label:"ERR",color:"error"};
    default:return{label:"·",color:"dim"};
  }
}
function wrap(text:string,width:number):string[]{const words=text.replace(/\s+/g," ").trim().split(" ").filter(Boolean);if(!words.length)return[""];const lines:string[]=[];let cur="";for(const word of words){const next=cur?`${cur} ${word}`:word;if(next.length<=width)cur=next;else{if(cur)lines.push(cur);cur=word.length>width?word.slice(0,width):word;}}if(cur)lines.push(cur);return lines;}
function wrapPreservingLines(text:string,width:number):string[]{const out:string[]=[];for(const raw of text.split(/\r?\n/)){if(!raw){out.push("");continue;}const indent=raw.match(/^\s*/)?.[0]??"";const body=raw.slice(indent.length);const wrapped=wrap(body,Math.max(8,width-Math.min(indent.length,8)));for(const [index,line] of wrapped.entries())out.push(`${index===0?indent.slice(0,8):"  "}${line}`.slice(0,width));}return out;}
function bar(value:number,count:number):string{const filled=Math.round(Math.max(0,Math.min(1,value))*count);return"•".repeat(filled)+"·".repeat(count-filled);}
function padVisible(value:string,width:number):string{const length=stripAnsi(value).length;return length>=width?value:value+" ".repeat(width-length);}
function truncatePlain(value:string,width:number):string{return value.length<=width?value:`${value.slice(0,Math.max(0,width-1))}…`;}
function stripAnsi(value:string):string{return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,"").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,"");}
