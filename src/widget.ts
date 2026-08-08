import type { Component, TUI } from "@earendil-works/pi-tui";
import type { ActivityEntry } from "./activity.js";
import { OrbMotion, OrbRenderer, rasterAt, type OrbCell, type OrbFrame, type OrbMode } from "./orb.js";
import { createOrbPalette, mix, type OrbPalette, type Rgb, type ThemeLike } from "./theme.js";
import { feedRowStyle, clipThoughtForDisplay, wrapFeed, wrapPlain } from "./feed-text.js";
import type { VoiceViewState } from "./types.js";

interface WidgetOptions { orbAspect:number; orbDensity:number; orbReactivity:number; orbBraille:boolean; panelHeight:number; activityLines:number; scratchpadPanelHeight:number }

export class VoiceWidget implements Component {
  private readonly motion = new OrbMotion();
  private readonly renderer: OrbRenderer;
  private palette: OrbPalette;
  private mode: OrbMode = "smoke";
  private frame: OrbFrame = { userEnergy:0, agentEnergy:0, energy:0, source:"idle" };
  /** Latest animation clock (ms) so the renderer can drive mode crossfades. */
  private nowMs = 0;
  /** Last frame that was actually sent to the TUI, used to skip imperceptible animation frames. */
  private lastPainted = { userEnergy:-1, agentEnergy:-1, t:-1, mode:"smoke" as OrbMode };
  constructor(private readonly tui:TUI, private readonly theme:ThemeLike, private readonly getState:()=>VoiceViewState, private readonly options:WidgetOptions) {
    this.renderer = new OrbRenderer(options.orbDensity, options.orbReactivity, options.orbBraille);
    // Every color in this widget comes from Pi's active theme. The palette
    // resolves the theme's primary accent and secondary (violet) tokens and
    // builds the orb gradient from them; Tokyo Night values are only a last
    // resort when a theme token cannot be resolved.
    this.palette = createOrbPalette(theme);
  }
  tick(nowMs=Date.now()):void {
    this.nowMs = nowMs;
    this.stepFrame(nowMs);
    // Discrete events (transcript, tool call, mute…) repaint immediately; sync
    // the animation gate's snapshot so the next tickAnimation doesn't paint
    // the same frame a second time.
    const f=this.frame; const p=this.lastPainted;
    p.userEnergy=f.userEnergy; p.agentEnergy=f.agentEnergy; p.t=f.t??0; p.mode=this.mode;
    this.tui.requestRender();
  }

  /**
   * Animation loop entry point. Steps the motion clock on every timer tick but
   * only paints when the rendered frame actually changed perceptibly — the
   * wave animation and the drifting light both run on the continuous clock, so
   * the frame is repainted as t advances in every mode. The old smoke-only
   * throttle existed for the pre-lighting renderer, where a 20Hz unconditional
   * repaint cost ~15ms of event-loop stall (audible audio drops); the surface
   * renderer is ~1ms at panel sizes now, so the clock gate is cheap and the
   * living sphere actually stays alive on screen in silence. A mode switch
   * repaints immediately, and a crossfade between two modes needs frames for
   * its whole duration, not just the first one.
   */
  tickAnimation(nowMs=Date.now()):void {
    this.nowMs = nowMs;
    this.stepFrame(nowMs);
    const f=this.frame;
    const p=this.lastPainted;
    if (!this.renderer.fading && this.mode===p.mode && Math.abs(f.userEnergy-p.userEnergy)<0.01 && Math.abs(f.agentEnergy-p.agentEnergy)<0.01
        && Math.abs((f.t??0)-p.t)<0.04) return;
    p.userEnergy=f.userEnergy; p.agentEnergy=f.agentEnergy; p.t=f.t??0; p.mode=this.mode;
    this.tui.requestRender();
  }
  private stepFrame(nowMs:number):void {
    const state=this.getState();
    this.frame=this.motion.step(nowMs,state.inputRms,state.outputRms,state.outputRms>0.015,state.muted);
    this.mode=this.resolveMode(state);
  }
  /**
   * Animation state: all modes share the same living noise-field sphere and
   * differ only in motion parameters and color — talking uses the audio-driven
   * two-tone identity, Pi working the calmer look with its cognition sweep,
   * otherwise the calm presence drift.
   */
  private resolveMode(state:VoiceViewState):OrbMode {
    if (state.source==="user" || this.frame.userEnergy>0.02) return "composing";
    // Reasoning voice models think before they speak; while no content has
    // landed the orb takes the calm cognition-pulse look (like Pi working).
    if (state.thinking || state.piAgentStatus==="working") return "searching";
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
    const requestedHeight=this.options.panelHeight;
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
        line+=cell.glyph?this.colorCell(cell):" ";
      }
      left.push(line);
    }
    const rightLines=this.renderActivity(state.activity,rightWidth,Math.min(bodyHeight,this.options.activityLines),state);
    // Title bar: "ORB" in the theme's primary accent, the live status
    // indicator (listening / thinking / waiting for Pi…) in the secondary
    // violet accent, and the Pi agent indicator in a theme-blue token.
    // Title is a single clean status line. `state.status` often already names
    // Pi's activity ("Pi working · listening", "waiting for Pi · …"); the
    // agent tag here only adds the Pi idle/working signal when the status
    // text hasn't already stated it, so "Pi working" never renders twice.
    const baseStatus=statusForDisplay(state.status,state.muted,state.thinking);
    const piTag=piStatusTag(state.piAgentStatus,baseStatus,state.thinking);
    const title=this.theme.fg("accent"," ORB ")
      +this.palette.secondaryText(`· ${baseStatus}`)
      +this.theme.fg("mdLink",piTag);
    const lines=[title+this.theme.fg("dim","─".repeat(Math.max(0,width-stripAnsi(title).length)))];
    const body=Math.max(left.length,rightLines.length);
    for(let i=0;i<body;i++)lines.push(`${padVisible(left[i]??"",leftWidth)}${" ".repeat(gap)}${rightLines[i]??""}`);
    lines.push(this.renderMeters(state,width));
    lines.push(this.theme.fg("dim","─".repeat(width)));
    return lines;
  }

  private renderActivity(entries:ActivityEntry[],width:number,maxLines:number,state:VoiceViewState):string[] {
    const rendered:string[]=[];
    const recent=entries.slice(-20);
    recent.forEach((entry,entryIndex)=>{
      // Reasoning rows carry the full thought text; the active display mode
      // decides whether they are hidden, shown as a clipped summary, or full.
      let rowText = entry.text;
      if (entry.kind === "thinking") {
        rowText = clipThoughtForDisplay(entry.text, state.thinkingDisplay) ?? "";
        if (!rowText) return; // hidden mode — drop the row entirely
      }
      const style=feedRowStyle(entry.kind);
      const prefix=`${style.label} `;
      const wrapW=Math.max(8,width-prefix.length);
      // Body: inline Markdown for prose rows (you/voice/thinking/…); plain
      // text for tool rows that keep their ✓/✗ outcome marks.
      const chunks=style.markdown
        ? wrapFeed(rowText,this.theme,style,wrapW)
        : wrapPlain(rowText,wrapW).map((c)=>this.colorToolText(c));
      chunks.forEach((chunk,index)=>{
        rendered.push(index===0
          ? this.theme.fg(style.labelColor,prefix)+chunk
          : this.theme.fg("dim"," ".repeat(prefix.length))+chunk);
      });
      if(entryIndex<recent.length-1) rendered.push("");
    });
    // Single, clean status: the feed placeholder mirrors the title so a
    // "live · listening" title is never paired with a contradicting feed row.
    if(!rendered.length)rendered.push(this.theme.fg("dim",state.thinking?"Thinking…":"Listening…"));
    return rendered.slice(-maxLines);
  }

  /**
   * Render a tool row. Pi style: tool title in the marker color, output with
   * the tool-output token, and leading ✓/✗ outcome marks get the theme's
   * success/error colors. This stays a plain (non-Markdown) path so outcome
   * markers keep their exact visual form.
   */
  private colorToolText(text:string):string {
    const mark=text.match(/^([✓✗])\s*(.*)$/);
    if(mark&&mark[1]){
      const body=mark[2]??"";
      return this.theme.fg(mark[1]==="✓"?"success":"error",mark[1])+this.theme.fg("toolOutput",body?` ${body}`:"");
    }
    return this.theme.fg("toolOutput",text);
  }

  private renderCompact(width:number,state:VoiceViewState):string[] {
    const h=Math.max(4,Math.min(6,this.options.panelHeight-3));
    const raster=this.renderer.render(width,h,this.options.orbAspect,this.frame,this.mode,this.nowMs||undefined);
    const lines=[this.theme.fg("accent",`ORB · `)+this.palette.secondaryText(statusForDisplay(state.status,state.muted,state.thinking))];
    for(let y=0;y<raster.height;y++){
      let line="";
      for(let x=0;x<raster.width;x++){
        const c=rasterAt(raster,x,y);
        line+=c.glyph?this.colorCell(c):" ";
      }
      lines.push(line);
    }
    const last=state.activity.at(-1);
    if(last){
      const style=feedRowStyle(last.kind);
      const text=truncatePlain(last.text,Math.max(8,width-style.label.length-1));
      const body=style.markdown
        ? (wrapFeed(text,this.theme,style,Math.max(8,width-style.label.length-1))[0]??"")
        : this.colorToolText(text);
      lines.push(this.theme.fg(style.labelColor,style.label+" ")+body);
    }
    return lines;
  }

  /**
   * The orb's color language, mapped from the site labs' two-energy-region
   * field: every cell is painted by its `identity` (where it sits on the
   * signed domain-warped field) along the theme's TWO anchors — the primary
   * accent and the secondary violet. The boundary between the two regions is
   * a feather around 0.5 that narrows as the sphere livens: composing keeps a
   * crisp two-tone split, searching a soft pulse, and idle smoke a broad calm
   * blend so the drift reads as breathing color rather than a hard seam.
   *
   * Brightness rides on the sphere's two-light `shade` (the far rim falls
   * toward the theme's dimmed accents, the lit face stays saturated), and
   * `filament` is the near-white pressure bloom the orb generates when a
   * pulse reaches the edge or the microphone shines — speaking flares toward
   * white, idle keeps just a faint sheen. Muted resolves the whole sphere to
   * a neutral gray (the field spigot is dead): no regions, no bloom.
   */
  private colorCell(mesh: OrbCell): string {
    const { glyph, shade, layer, identity, filament } = mesh;
    if (layer === "none") return this.theme.fg(shade > 0.5 ? "muted" : "dim", glyph);
    const f = this.frame;
    if (f.muted === true) {
      // The muted orb is a gray pied-photon: keep its shading but drop the
      // color regions and the bloom, exactly like the quiet presence sphere.
      const gray = desaturate(this.palette.rampAt(0.4));
      return this.palette.color(scale(gray, 0.42 + 0.58 * shade), glyph);
    }
    const activity = clamp01(f.energy * this.options.orbReactivity);

    // The signed two-region field → position on the primary↔secondary line.
    // A warm identity (near 1) is the violet/energy anchor, a cool one (near
    // 0) the primary anchor; the feather around 0.5 is mode-dependent.
    const feather = this.mode === "composing" ? 0.085 : this.mode === "searching" ? 0.16 : 0.24;
    const u = clamp01((identity - (0.5 - feather)) / (2 * feather));
    const w = u * u * (3 - 2 * u);
    let color = mix(this.palette.primary, this.palette.secondary, w);

    // Breathing brightness from the two-light shading; the far rim darkens.
    color = scale(color, 0.5 + 0.5 * shade);

    // The near-white pressure bloom rides on the filament channel (audio
    // pulses, mic luminance, the thinking sweep). Talking flares toward
    // white; idle and thinking keep just a faint sheen on the bright face.
    const sheen = this.mode === "smoke" ? 0.16 : this.mode === "searching" ? 0.2 : 0.55 + 0.3 * activity;
    color = mix(color, WHITE, clamp01(filament * sheen));
    return this.palette.color(color, glyph);
  }

  /**
   * Footer meters line: the active dots are colored so the live input pops —
   * the YOU (microphone) meter runs the primary-accent half of the theme
   * ramp, the ORB (voice) meter the secondary violet half, and each dot is a
   * shade brighter than the last as the bar fills. Inactive dots stay dim.
   * If the stats don't fit the width, falls back to the plain dim line.
   */
  private renderMeters(state:VoiceViewState,width:number):string{
    const f=this.frame;
    const sourceLabel=f.source==="agent"?"ORB":f.source.toUpperCase();
    const stats=`${sourceLabel}  buffer ${state.audioQueuedMs}ms · recoveries ${state.audioRecoveries}`;
    const health= state.audioPhase === "choppy" || state.audioPhase === "recovering" ? this.theme.fg("error",` · ${state.audioPhase.toUpperCase()}`) : "";
    const plain=`YOU ${barText(f.userEnergy,8)}  ORB ${barText(f.agentEnergy,8)}  ${stats}${stripAnsi(health)}`;
    if(plain.length>width) return this.theme.fg("dim",truncatePlain(plain,width));
    return `YOU ${this.meterBar(f.userEnergy,8,0.2,0.45)}  ORB ${this.meterBar(f.agentEnergy,8,0.6,0.98)}  ${this.theme.fg("dim",stats)}${health}`;
  }

  /** One meter's dots on the theme ramp from `lo` to `hi` (sqrt-scaled):
   * filled dots are colored, each a shade brighter than the last; empty dots
   * are dim. */
  private meterBar(value:number,count:number,lo:number,hi:number):string{
    const filled=Math.round(Math.sqrt(Math.max(0,Math.min(1,value)))*count);
    let out="";
    for(let i=0;i<filled;i++){
      const t=lo+(hi-lo)*(filled>1?i/(filled-1):0);
      out+=this.palette.color(this.palette.rampAt(t),"•");
    }
    return out+this.theme.fg("dim","·".repeat(count-filled));
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
 * While the model is generating a response without any delivered content yet
 * (after "response.created", before the first audio/transcript) the whole
 * line reads "Thinking…" so the user sees the voice model reasoning before it
 * speaks.
 */
export function statusForDisplay(status: string, muted: boolean, thinking = false): string {
  if (thinking) return "Thinking…";
  return muted ? status.replace(/\blistening\b/g, "muted") : status;
}

/**
 * The trailing Pi-agent indicator (" · Pi working" / " · Pi idle"). Many
 * status strings already name what Pi is doing ("Pi working · listening",
 * "Pi task queued · listening", "waiting for Pi · listening", …), so a
 * naive append would show "Pi working" twice. Return the tag only when the
 * status text hasn't already stated Pi's activity, and skip it entirely
 * while the model is thinking (the line reads just "Thinking…").
 */
export function piStatusTag(agentStatus: string, statusText: string, thinking = false): string {
  if (thinking || !agentStatus) return "";
  // Statuses that already name Pi's activity need no trailing tag, otherwise
  // "Pi working · listening" would render as "· Pi working · listening · Pi working".
  if (/^(Pi|waiting for Pi|watching Pi)\b/.test(statusText)) return "";
  return ` · Pi ${agentStatus}`;
}


function barText(value:number,count:number):string{
  // Perceptual (sqrt) scale for the audio meters: loudness is roughly
  // logarithmic, so a linear bar would barely light up during quiet speech.
  // The sqrt curve boosts low levels — the mic dot starts moving from the
  // first syllable instead of sitting empty until the input gets loud.
  // Plain variant: used to measure the line width before the colored dots
  // are drawn by meterBar().
  const boosted=Math.sqrt(Math.max(0,Math.min(1,value)));
  const filled=Math.round(boosted*count);
  return"•".repeat(filled)+"·".repeat(count-filled);
}
function padVisible(value:string,width:number):string{const length=stripAnsi(value).length;return length>=width?value:value+" ".repeat(width-length);}
function truncatePlain(value:string,width:number):string{return value.length<=width?value:`${value.slice(0,Math.max(0,width-1))}…`;}
function stripAnsi(value:string):string{return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,"").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,"");}
