import type { Component, TUI } from "@earendil-works/pi-tui";
import type { ActivityEntry } from "./activity.js";
import { OrbMotion, OrbRenderer, orbLayerHeat, rasterAt, type OrbFrame, type OrbLayer, type OrbMode } from "./orb.js";
import { createOrbPalette, mix, type OrbPalette, type OrbThemeColor, type Rgb, type ThemeLike } from "./theme.js";
import type { VoiceViewState } from "./types.js";

interface WidgetOptions { orbAspect:number; orbDensity:number; orbReactivity:number; orbBraille:boolean; panelHeight:number; activityLines:number; scratchpadPanelHeight:number }

export class VoiceWidget implements Component {
  private readonly motion = new OrbMotion();
  private readonly renderer: OrbRenderer;
  private palette: OrbPalette;
  private mode: OrbMode = "smoke";
  private frame: OrbFrame = { userEnergy:0, agentEnergy:0, energy:0, peak:0, phaseA:0, phaseB:0, source:"idle" };
  /** Latest animation clock (ms) so the renderer can drive mode crossfades. */
  private nowMs = 0;
  /** Last frame that was actually sent to the TUI, used to skip imperceptible animation frames. */
  private lastPainted = { userEnergy:-1, agentEnergy:-1, phaseA:-1, phaseB:-1, t:-1, mode:"smoke" as OrbMode };
  /** Scratchpad wrap cache: content is immutable, so reference+width equality is a safe key. */
  private wrapKey: string | undefined;
  private wrapWidth = 0;
  private wrapLines: string[] = [];

  constructor(private readonly tui:TUI, private readonly theme:ThemeLike, private readonly getState:()=>VoiceViewState, private readonly options:WidgetOptions) {
    this.renderer = new OrbRenderer(options.orbDensity, options.orbReactivity, options.orbBraille);
    // Every color in this widget comes from Pi's active theme. The palette
    // resolves the theme's primary accent and secondary (violet) tokens and
    // builds the orb gradient from them; Tokyo Night values are only a last
    // resort when a theme token cannot be resolved.
    this.palette = createOrbPalette(theme);
  }
  tick(nowMs=Date.now()):void { this.nowMs = nowMs; this.stepFrame(nowMs); this.tui.requestRender(); }

  /**
   * Animation loop entry point. Steps the motion clock on every timer tick but
   * only paints when the rendered frame actually changed perceptibly. The orb
   * drifts at ~0.2-0.4 rad/s, so a 20Hz unconditional repaint is wasted work on
   * the same thread that must deliver provider audio to the Go sidecar; any
   * stall it causes drains the hardware jitter buffer into audible gaps.
   */
  tickAnimation(nowMs=Date.now()):void {
    this.nowMs = nowMs;
    this.stepFrame(nowMs);
    const f=this.frame;
    const p=this.lastPainted;
    // The wave animation and the drifting light both run on the continuous
    // clock, so the frame must be repainted as t advances in every mode. The
    // old smoke-only throttle existed for the pre-lighting renderer, where a
    // 20Hz unconditional repaint cost ~15ms of event-loop stall (audible
    // audio drops); the surface renderer is ~1ms at panel sizes now, so the
    // clock gate is cheap and the living sphere actually stays alive on
    // screen in silence. A mode switch repaints immediately, and a crossfade
    // between two modes needs frames for its whole duration, not just the
    // first one.
    if (!this.renderer.fading && this.mode===p.mode && Math.abs(f.userEnergy-p.userEnergy)<0.01 && Math.abs(f.agentEnergy-p.agentEnergy)<0.01
        && Math.abs(f.phaseA-p.phaseA)<0.035 && Math.abs(f.phaseB-p.phaseB)<0.035
        && Math.abs((f.t??0)-p.t)<0.04) return;
    p.userEnergy=f.userEnergy; p.agentEnergy=f.agentEnergy; p.phaseA=f.phaseA; p.phaseB=f.phaseB; p.t=f.t??0; p.mode=this.mode;
    this.tui.requestRender();
  }
  private stepFrame(nowMs:number):void {
    const state=this.getState();
    this.frame=this.motion.step(nowMs,state.inputRms,state.outputRms,state.outputRms>0.015,state.muted);
    this.mode=this.resolveMode(state);
  }
  /**
   * Animation state: all modes share the same carved wave pattern — talking
   * colors it with the bright audio envelope, Pi working with the calmer cool
   * identity, otherwise the calm listening gradient.
   */
  private resolveMode(state:VoiceViewState):OrbMode {
    if (state.source==="user" || this.frame.userEnergy>0.02) return "composing";
    if (state.piAgentStatus==="working") return "searching";
    return "smoke";
  }
  invalidate():void {
    // Pi calls invalidate() when the active theme changes in settings. The
    // palette bakes precomputed ANSI codes (secondaryText violet, orb glyph
    // gradient), so rebuild it here; otherwise the status text and the orb
    // would keep the colors of the theme that was active at construction.
    this.palette = createOrbPalette(this.theme);
    this.tui.requestRender();
  }
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
    const raster=this.renderer.render(leftWidth,bodyHeight,this.options.orbAspect,this.frame,this.mode,this.nowMs||undefined);
    const left:string[]=[];
    for(let y=0;y<raster.height;y++){
      let line="";
      for(let x=0;x<raster.width;x++){
        const cell=rasterAt(raster,x,y);
        line+=cell.glyph?this.colorCell(cell.glyph,cell.shade,cell.layer,x,raster.width):" ";
      }
      left.push(line);
    }
    const rightLines=state.scratchpad.open
      ? this.renderScratchpad(state,rightWidth,bodyHeight)
      : this.renderActivity(state.activity,rightWidth,Math.min(bodyHeight,this.options.activityLines));
    // Title bar: "ORB" in the theme's primary accent, the live status
    // indicator (listening / thinking / waiting for Pi…) in the secondary
    // violet accent, and the Pi agent indicator in a theme-blue token.
    const title=this.theme.fg("accent"," ORB ")
      +this.palette.secondaryText(`· ${statusForDisplay(state.status,state.muted)}`)
      +this.theme.fg("mdLink",` · Pi ${state.piAgentStatus}`);
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
    // Scratchpad title in the theme's primary accent.
    lines.push(this.theme.fg("accent",truncatePlain(`SCRATCHPAD · ${state.scratchpad.title}${dirty}`,width)));
    const logBudget=Math.min(4,Math.max(2,Math.floor(height*0.28)));
    const contentBudget=Math.max(2,height-logBudget-2);
    const content=state.scratchpad.content;
    // Re-wrap only when the content or width actually changed; the full
    // document can be hundreds of KB and re-wrapping it on every animation
    // frame is pure main-thread stall on the audio delivery path.
    if (this.wrapKey!==content || this.wrapWidth!==width) {
      this.wrapLines=wrapPreservingLines(content,width);
      this.wrapKey=content;
      this.wrapWidth=width;
    }
    const contentLines=this.wrapLines;
    // Scratchpad items in the secondary (violet) accent.
    if(!contentLines.length) lines.push(this.theme.fg("dim","(empty — keep talking, load a file, or edit with /voice scratchpad edit)"));
    else for(const line of contentLines.slice(-contentBudget)) lines.push(this.palette.secondaryText(line));
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
      chunks.forEach((chunk,index)=>{
        const text=this.colorActivityText(entry.kind,chunk);
        rendered.push(index===0
          ? this.theme.fg(color,prefix)+text
          : this.theme.fg("dim"," ".repeat(prefix.length))+text);
      });
      if(entryIndex<recent.length-1) rendered.push("");
    });
    if(!rendered.length)rendered.push(this.theme.fg("dim","Listening…"));
    return rendered.slice(-maxLines);
  }

  /**
   * Color an activity text chunk with the active theme. Tool rows (Pi's
   * output) use Pi's tool-output token so they match how Pi itself renders
   * tools, and leading ✓/✗ outcome marks get the theme's success/error colors.
   */
  private colorActivityText(kind:ActivityEntry["kind"],text:string):string {
    const bodyColor:OrbThemeColor=kind==="voice-tool"?"toolOutput":kind==="error"?"error":"muted";
    const mark=text.match(/^([✓✗])\s*(.*)$/);
    if(mark&&mark[1]){
      return this.theme.fg(mark[1]==="✓"?"success":"error",mark[1])+this.theme.fg(bodyColor,mark[2]??"");
    }
    return this.theme.fg(bodyColor,text);
  }

  private renderCompact(width:number,state:VoiceViewState):string[] {
    if(state.scratchpad.open){
      const lines=[this.theme.fg("accent",truncatePlain(`ORB · SCRATCHPAD · ${state.scratchpad.title}`,width))];
      for(const line of wrapPreservingLines(state.scratchpad.content,width).slice(-Math.max(3,this.options.panelHeight-2))) lines.push(this.palette.secondaryText(line));
      return lines;
    }
    const h=Math.max(4,Math.min(6,this.options.panelHeight-3));
    const raster=this.renderer.render(width,h,this.options.orbAspect,this.frame,this.mode,this.nowMs||undefined);
    const lines=[this.theme.fg("accent",`ORB · `)+this.palette.secondaryText(statusForDisplay(state.status,state.muted))];
    for(let y=0;y<raster.height;y++){
      let line="";
      for(let x=0;x<raster.width;x++){
        const c=rasterAt(raster,x,y);
        line+=c.glyph?this.colorCell(c.glyph,c.shade,c.layer,x,raster.width):" ";
      }
      lines.push(line);
    }
    const last=state.activity.at(-1);
    if(last){
      const {label,color}=styleFor(last.kind);
      lines.push(this.theme.fg(color,label+" ")+this.colorActivityText(last.kind,truncatePlain(last.text,Math.max(8,width-label.length-1))));
    }
    return lines;
  }

  private colorCell(glyph:string,shade:number,layer:OrbLayer,x:number,width:number):string {
    // Themed orb layers map onto the primary→secondary gradient that the
    // palette derives from the active theme; anything outside the smoke uses
    // the theme's neutral tokens.
    if(layer==="none")return this.theme.fg(shade>0.5?"muted":"dim",glyph);
    // Listening: the same themed wave as the other modes. Mic input intensifies
    // the color — silence (or muting) keeps the calm gradient dim but alive,
    // distinct from the bright talking envelope below.
    if(this.mode==="smoke"){
      const f=this.frame;
      const base=this.palette.rampAt(orbLayerHeat(layer,shade));
      if(f.muted)return this.palette.color(desaturate(base),glyph);
      const activity=clamp01(f.energy*this.options.orbReactivity);
      // Disturbance-free frames stay dim and calm; mic energy saturates toward
      // the mid-ramp and brightens the whole sphere.
      const c=mix(base,mix(this.palette.primary,this.palette.secondary,0.5),0.45*activity);
      return this.palette.color(scale(c,0.6+0.4*activity),glyph);
    }
    // Audio-reactive modes color each cell from the live audio envelope:
    // mic energy biases toward the theme's primary accent, voice output toward
    // the secondary violet, saturation grows with activity, and bright cells
    // flare toward white on sharp transients. Muted renders a gray sphere.
    const f=this.frame;
    const base=this.palette.rampAt(orbLayerHeat(layer,shade));
    if(f.muted)return this.palette.color(desaturate(base),glyph);
    const activity=clamp01(f.energy*this.options.orbReactivity);
    const xNorm=width<=1?0:x/(width-1);
    const input=clamp01(f.userEnergy);
    const output=clamp01(f.agentEnergy);
    const inW=input*(1.05-0.35*xNorm);
    const outW=output*(0.70+0.35*xNorm);
    const sum=inW+outW+0.0001;
    if(this.mode==="searching"){
      // Working: a calmer, cooler identity — softly desaturated and dimmed so
      // "Pi is thinking" reads as focused rather than loud, clearly distinct
      // from the bright saturated talking sphere.
      const cool=mix(this.palette.primary,this.palette.secondary,0.35+0.4*activity);
      const c=scale(mix(base,cool,clamp01(0.25+0.6*activity)),0.72+0.28*activity);
      return this.palette.color(c,glyph);
    }
    // Talking: the full audio envelope with white-hot transient flares.
    const hue=mix(this.palette.primary,this.palette.secondary,outW/sum);
    const saturation=clamp01(0.25+activity*0.9);
    let c=mix(base,hue,saturation);
    const transient=clamp01(f.transient??0);
    const hot=clamp01((shade-0.68)*2.8)*activity;
    c=mix(c,WHITE,hot*(0.35+0.45*transient));
    return this.palette.color(c,glyph);
  }
}

function clamp01(value:number):number{return Math.max(0,Math.min(1,value))}
/** Scale an RGB color toward black by a factor in [0,1] (dimming). */
function scale(c:Rgb,f:number):Rgb{return{r:c.r*f,g:c.g*f,b:c.b*f}}
/** Luminance-preserving grayscale used for the muted orb. */
function desaturate(c:Rgb):Rgb{
  const l=0.299*c.r+0.587*c.g+0.114*c.b;
  return { r:l, g:l, b:l };
}
const WHITE:Rgb={ r:255, g:255, b:255 };

/**
 * Status line shown in the widget title. While the microphone is muted the
 * status keeps its context ("live", "Pi working", …) but the word
 * "listening" becomes "muted" in the same position, so the mute state is
 * communicated by the status text itself instead of a separate indicator.
 */
export function statusForDisplay(status: string, muted: boolean): string {
  return muted ? status.replace(/\blistening\b/g, "muted") : status;
}

function styleFor(kind:ActivityEntry["kind"]):{label:string;color:OrbThemeColor}{
  switch(kind){
    case"you":return{label:"YOU",color:"accent"};               // user speech → primary accent
    case"voice":return{label:"ORB",color:"customMessageLabel"}; // orb speech → secondary violet
    case"voice-tool":return{label:"ORB›",color:"toolTitle"};    // Pi tool output → theme tool title
    case"error":return{label:"ERR",color:"error"};
    case"system":return{label:"·",color:"thinkingText"};
    default:return{label:"·",color:"dim"};
  }
}
function wrap(text:string,width:number):string[]{const words=text.replace(/\s+/g," ").trim().split(" ").filter(Boolean);if(!words.length)return[""];const lines:string[]=[];let cur="";for(const word of words){const next=cur?`${cur} ${word}`:word;if(next.length<=width)cur=next;else{if(cur)lines.push(cur);cur=word.length>width?word.slice(0,width):word;}}if(cur)lines.push(cur);return lines;}
function wrapPreservingLines(text:string,width:number):string[]{const out:string[]=[];for(const raw of text.split(/\r?\n/)){if(!raw){out.push("");continue;}const indent=raw.match(/^\s*/)?.[0]??"";const body=raw.slice(indent.length);const wrapped=wrap(body,Math.max(8,width-Math.min(indent.length,8)));for(const [index,line] of wrapped.entries())out.push(`${index===0?indent.slice(0,8):"  "}${line}`.slice(0,width));}return out;}
function bar(value:number,count:number):string{const filled=Math.round(Math.max(0,Math.min(1,value))*count);return"•".repeat(filled)+"·".repeat(count-filled);}
function padVisible(value:string,width:number):string{const length=stripAnsi(value).length;return length>=width?value:value+" ".repeat(width-length);}
function truncatePlain(value:string,width:number):string{return value.length<=width?value:`${value.slice(0,Math.max(0,width-1))}…`;}
function stripAnsi(value:string):string{return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,"").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,"");}
