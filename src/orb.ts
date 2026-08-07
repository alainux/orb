import type { VoiceSource } from "./types.js";

export type OrbLayer = "none" | "mistA" | "mistB" | "mistC" | "filament";

/**
 * Orb animation states. Every state renders the same fixed full sphere of
 * dots (the lab's negative-space technique) and carves the same traveling
 * wave pattern out of it; the states differ only in color identity (see
 * widget.ts): `smoke` (listening) is the calm themed gradient, `composing`
 * (speaking) the bright audio envelope with white-hot flares, and `searching`
 * (thinking) a calmer, cooler look. The sphere is never rotated as a rigid
 * body — the wave travels by phase.
 */
export type OrbMode = "smoke" | "composing" | "searching";

/** How long a mode switch dissolves between the two renderings (seconds). */
const ORB_MODE_FADE_SECONDS = 0.55;

export interface OrbCell {
  coverage: number;
  shade: number;
  filament: number;
  density: number;
  glyph: string;
  layer: OrbLayer;
}

export interface OrbFrame {
  userEnergy: number;
  agentEnergy: number;
  energy: number;
  peak: number;
  phaseA: number;
  phaseB: number;
  source: VoiceSource;
  /** Continuous animation clock in seconds (advances only while not muted). */
  t?: number;
  /** Sharp attack transient: spikes when audio jumps, decays at ~8/s. */
  transient?: number;
  /** Whether the microphone is muted (audio reactivity goes dormant). */
  muted?: boolean;
}

export interface OrbRaster {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  cellAspect: number;
  cells: OrbCell[];
}

const EMPTY_CELL: OrbCell = Object.freeze({ coverage: 0, shade: 0, filament: 0, density: 0, glyph: "", layer: "none" });

/**
 * Where each rendered layer sits on the Orb's theme gradient. The gradient is
 * built from the active Pi theme's primary accent → secondary accent tokens
 * (see src/theme.ts), so every visual state adapts to the current theme
 * (e.g. Tokyo Night) instead of being hardcoded. `base` is the gradient
 * position of a dim cell and `spread` scales with the per-cell `shade` toward
 * the brighter (secondary) end of the gradient.
 */
export const ORB_LAYER_GRADIENT: Record<OrbLayer, { base: number; spread: number }> = {
  filament: { base: 0.66, spread: 0.34 }, // bright energy strands → violet highlight
  mistA: { base: 0.4, spread: 0.34 }, // mid mist → violet-tinged
  mistB: { base: 0.16, spread: 0.34 }, // flow mist → primary accent
  mistC: { base: 0.03, spread: 0.24 }, // background mist → deep primary
  none: { base: 0, spread: 0 },
};

/**
 * Map a rendered cell's layer + shade to a position in [0,1] on the theme
 * gradient (0 = deep primary, 1 = bright secondary highlight).
 */
export function orbLayerHeat(layer: OrbLayer, shade: number): number {
  const cfg = ORB_LAYER_GRADIENT[layer] ?? ORB_LAYER_GRADIENT.none;
  return clamp(cfg.base + cfg.spread * shade, 0, 1);
}

export class OrbMotion {
  private lastMs = 0;
  private userEnergy = 0;
  private agentEnergy = 0;
  private peak = 0;
  private phaseA = 0;
  private phaseB = 0;
  private elapsed = 0;
  private transient = 0;
  private prevTarget = 0;

  step(nowMs: number, inputRms: number, outputRms: number, agentSpeaking: boolean, muted = false): OrbFrame {
    if (this.lastMs === 0) this.lastMs = nowMs;
    const dt = clamp((nowMs - this.lastMs) / 1000, 1 / 240, 0.075);
    this.lastMs = nowMs;

    // While muted the mic is dead: the user cannot drive the field, and the
    // phase drift freezes too — the base wave keeps traveling, but nothing
    // reacts to input. Agent playback keeps animating.
    const userTarget = muted ? 0 : clamp((inputRms - 0.006) / 0.12, 0, 1);
    let agentTarget = clamp((outputRms - 0.0035) / 0.17, 0, 1);
    if (agentSpeaking && agentTarget < 0.1) agentTarget = 0.1;
    if (!agentSpeaking && agentTarget < 0.018) agentTarget = 0;

    this.userEnergy = envelope(this.userEnergy, userTarget, dt, 0.045, 0.34);
    this.agentEnergy = envelope(this.agentEnergy, agentTarget, dt, 0.04, 0.28);
    const energy = Math.max(this.userEnergy, this.agentEnergy);

    // Attack transient (from the lab): spikes on sharp audio onsets and decays
    // at ~8/s, driving the sharper surface vibration of the audio-reactive modes.
    const rawTarget = Math.max(userTarget, agentTarget, Math.sqrt((userTarget * userTarget + agentTarget * agentTarget) * 0.55));
    const rawDelta = Math.max(0, rawTarget - this.prevTarget);
    this.transient = Math.max(rawDelta * 2.7, this.transient * Math.exp(-dt * 8));
    this.prevTarget = rawTarget;

    if (energy > this.peak) this.peak = envelope(this.peak, energy, dt, 0.022, 0.72);
    else this.peak *= Math.exp(-dt / 0.78);

    // The base wave animation runs on a continuous clock that never stops:
    // even muted, the carved grooves keep traveling over the sphere (only the
    // audio-driven disturbance and color go dormant). The phase drift still
    // freezes while muted — the mic is dead — though phaseA/B no longer drive
    // the surface rendering.
    this.elapsed += dt;
    if (!muted) {
      const voiceDrive = 0.55 * this.userEnergy + 0.45 * this.agentEnergy;
      this.phaseA = mod(this.phaseA + dt * (0.23 + 0.18 * voiceDrive), Math.PI * 2);
      this.phaseB = mod(this.phaseB + dt * (0.11 + 0.11 * voiceDrive), Math.PI * 2);
    }

    let source: VoiceSource = "idle";
    if (this.agentEnergy > 0.035 && this.agentEnergy >= this.userEnergy * 0.9) source = "agent";
    else if (this.userEnergy > 0.025) source = "user";

    return { userEnergy: this.userEnergy, agentEnergy: this.agentEnergy, energy, peak: this.peak, phaseA: this.phaseA, phaseB: this.phaseB, source, t: this.elapsed, transient: this.transient, muted };
  }
}

export class OrbRenderer {
  private cells: OrbCell[] = [];
  private lastMode: OrbMode = "smoke";
  private fadeFrom: OrbMode | null = null;
  private fadeT = 1;
  private clockMs = 0;
  private rendered = false;
  constructor(
    private readonly densityScale = 1.08,
    /** Lab reactivity 0..1: how strongly audio energy drives motion and color. */
    private readonly reactivity = 0.7,
    /** Render each terminal cell as an 8-dot Braille glyph (2×4 subpixels). */
    private readonly braille = false,
  ) {}

  /** True while a mode change is still dissolving between states. */
  get fading(): boolean {
    return this.fadeFrom !== null && this.fadeT < 1;
  }

  render(width: number, height: number, cellAspect: number, frame: OrbFrame, mode: OrbMode = "smoke", nowMs?: number): OrbRaster {
    const raster = this.prepareRaster(width, height, cellAspect, frame, mode);
    if (!raster.radiusY) return raster;

    // Crossfade bookkeeping: on a mode change, dissolve from the previous
    // mode's raster into the new one over ~0.55s (eased), so state switches
    // read as a smooth morph instead of a sudden geometry pop. Without a
    // monotonic clock (tests, one-shot renders) the transition snaps — the
    // widget always supplies nowMs from its animation ticks.
    const clock = nowMs ?? (frame.t ?? 0) * 1000;
    if (!this.rendered) {
      this.rendered = true;
      this.lastMode = mode;
      this.clockMs = clock;
    } else if (mode !== this.lastMode) {
      this.fadeFrom = this.lastMode;
      this.fadeT = 0;
      this.lastMode = mode;
    }
    if (nowMs === undefined) {
      this.fadeFrom = null;
      this.fadeT = 1;
      return this.renderMode(raster, frame, mode);
    }
    if (this.fadeFrom !== null) {
      const dt = this.clockMs ? clamp((clock - this.clockMs) / 1000, 0, 1) : 0.016;
      this.clockMs = clock;
      this.fadeT = Math.min(1, this.fadeT + dt / ORB_MODE_FADE_SECONDS);
      if (this.fadeT >= 1) {
        this.fadeFrom = null;
      } else {
        const w = smoothstep(0, 1, this.fadeT);
        const from = this.fadeFrom;
        const fromRaster = this.scratchRaster(raster);
        const toRaster = this.scratchRaster(raster);
        this.renderMode(fromRaster, frame, from);
        this.renderMode(toRaster, frame, mode);
        this.dissolve(fromRaster, toRaster, w);
        return raster;
      }
    } else {
      this.clockMs = clock;
    }
    return this.renderMode(raster, frame, mode);
  }

  /** Set up the raster geometry and reset the shared cell buffer. */
  private prepareRaster(width: number, height: number, cellAspect: number, frame: OrbFrame, mode: OrbMode): OrbRaster {
    const raster: OrbRaster = { width, height, centerX: 0, centerY: 0, radiusX: 0, radiusY: 0, cellAspect, cells: [] };
    if (width < 8 || height < 6) return raster;

    cellAspect = clamp(cellAspect, 0.45, 3);
    const maxRadiusY = Math.min((height - 2) / 2, (width - 2) / (2 * cellAspect));
    if (maxRadiusY < 2) return raster;

    const energy = clamp(frame.energy, 0, 1);
    // Every mode renders a living sphere: even a silent room keeps an ambient
    // presence floor so the orb never collapses into a bland static field.
    // Muted is exempt — the wave keeps traveling at its minimum, but the
    // sphere stays compact rather than breathing with the room.
    const ambient = !frame.muted ? clamp(0.34 + 0.66 * energy, 0, 1) : energy;
    const radiusEnergy = frame.muted ? 0 : ambient;
    const baseRadiusY = maxRadiusY * 0.79;
    const radiusY = Math.min(maxRadiusY * 0.97, baseRadiusY * (1 + 0.105 * radiusEnergy));
    const radiusX = radiusY * cellAspect;
    raster.centerX = (width - 1) / 2;
    raster.centerY = (height - 1) / 2;
    raster.radiusX = radiusX;
    raster.radiusY = radiusY;
    raster.cellAspect = cellAspect;

    const required = width * height;
    if (this.cells.length !== required) this.cells = Array.from({ length: required }, () => ({ ...EMPTY_CELL }));
    else for (let i = 0; i < required; i++) this.cells[i] = { ...EMPTY_CELL };
    raster.cells = this.cells;
    return raster;
  }

  /** A copy of the raster geometry with a fresh, empty cell buffer. */
  private scratchRaster(template: OrbRaster): OrbRaster {
    return {
      ...template,
      cells: Array.from({ length: template.width * template.height }, () => ({ ...EMPTY_CELL })),
    };
  }

  /**
   * Blend the outgoing raster into the incoming one per cell: cells present in
   * both keep a crossfaded shade while their glyph swaps at a per-cell
   * staggered point (golden-ratio hash), so the geometry morphs gradually
   * instead of the whole field popping at once; cells unique to either side
   * fade their intensity in/out — a dissolve rather than a cut.
   */
  private dissolve(from: OrbRaster, to: OrbRaster, w: number): void {
    const fromW = 1 - w;
    const { width } = from;
    for (let i = 0; i < this.cells.length; i++) {
      const ca = from.cells[i];
      const cb = to.cells[i];
      if (!ca || !cb) continue;
      if (ca.glyph && cb.glyph) {
        const x = i % width;
        const y = Math.floor(i / width);
        const flipAt = 0.35 + 0.3 * hash01(x, y, 0x51e17);
        const glyph = w < flipAt ? ca.glyph : cb.glyph;
        this.cells[i] = {
          ...(glyph === ca.glyph ? ca : cb),
          shade: clamp(ca.shade * fromW + cb.shade * w, 0, 1),
        };
      } else if (ca.glyph) {
        this.cells[i] = { ...ca, shade: ca.shade * fromW };
      } else if (cb.glyph) {
        this.cells[i] = { ...cb, shade: cb.shade * w };
      }
    }
  }

  /** Render the given mode's geometry into the raster's cell buffer. */
  private renderMode(raster: OrbRaster, frame: OrbFrame, mode: OrbMode): OrbRaster {
    // Every mode renders the same living sphere with the same carved wave
    // pattern (negative space — see the source-math Braille lab); the mode
    // only selects the color identity (see widget.ts). Braille re-rasterizes
    // at 2×4 subpixel resolution and packs each cell into a U+2800+mask glyph;
    // glyph mode tests one sample per cell.
    if (this.braille) return this.renderSurface(raster, frame, true);
    return this.renderSurface(raster, frame, false);
  }

  /** Reused subpixel field buffer — avoids a multi-KB allocation per frame. */
  private brailleField: Float32Array | undefined;

  /**
   * Surface renderer — the orb's one visual language. Every mode draws the
   * same full sphere of dots (the lab's negative-space technique from
   * site/orb-braille-source-math-variations.html) and carves listening's
   * traveling wave grooves out of it. Microphone/voice energy widens the
   * grooves and adds disturbance; muted or silent frames keep the same base
   * wave traveling at its minimum disturbance.
   *
   * The sphere is deliberately NOT rotated as a rigid body: at terminal
   * resolution, rotating point clouds alias into incoherent shimmer. Here the
   * sphere stays fixed and the wave travels over its surface by phase — a
   * motion that reads cleanly even in a 2×4 subpixel grid.
   *
   * In `sub` mode every terminal cell is split into 2×4 subpixels (Braille);
   * otherwise each cell center is sampled directly (glyph mode). The surface
   * is smooth below the subpixel grid, so per-subpixel shading keeps the look
   * while per-row latitude work keeps the loop fast.
   */
  private renderSurface(raster: OrbRaster, frame: OrbFrame, sub: boolean): OrbRaster {
    const fw = raster.width * (sub ? 2 : 1);
    const fh = raster.height * (sub ? 4 : 1);
    const field = this.surfaceField(fw, fh);
    const cx = raster.centerX * (sub ? 2 : 1);
    const cy = raster.centerY * (sub ? 4 : 1);
    const radiusX = raster.radiusX * (sub ? 2 : 1);
    const radiusY = raster.radiusY * (sub ? 4 : 1);
    const energy = clamp(frame.energy, 0, 1);
    // Audio widens the carved grooves and adds disturbance; muted frames get
    // none of it, so the base wave keeps traveling at its minimum.
    const audio = frame.muted ? 0 : clamp(energy * (0.4 + 0.6 * this.reactivity), 0, 1);
    const transient = frame.muted ? 0 : clamp(frame.transient ?? 0, 0, 1);
    const t = frame.t ?? 0;
    const edge = Math.min(0.18, 0.56 / radiusY);
    const edgeMin = 1 - edge;
    const edgeMax = 1 + edge;
    const edgeMin2 = edgeMin * edgeMin;
    const edgeMax2 = edgeMax * edgeMax;
    for (let fy = 0; fy < fh; fy++) {
      const ny = (fy - cy) / radiusY;
      const lat = Math.asin(clamp(ny, -1, 1));
      const row = fy * fw;
      for (let fx = 0; fx < fw; fx++) {
        const nx = (fx - cx) / radiusX;
        const r2 = nx * nx + ny * ny;
        if (r2 >= edgeMax2) continue;
        let coverage = 1;
        if (r2 > edgeMin2) {
          coverage = 1 - smoothstep(edgeMin, edgeMax, Math.sqrt(r2));
          if (coverage <= 0.02) continue;
        }
        const z = Math.sqrt(Math.max(0, 1 - r2));
        if (isCarved(nx, z, lat, audio, transient, t, sub ? 1 : 4)) continue;
        // Depth shading: front dots bright, limb dots dim — the sphere reads
        // as a solid ball with a front-to-back gradient. Audio and transients
        // add a shimmering brightening.
        const depth = 0.15 + 0.85 * z;
        const shimmer = 0.08 * Math.sin(nx * 11 + ny * 7 + t * 2.6) + 0.22 * transient * Math.sin(nx * 17 - t * 29);
        field[row + fx] = clamp(coverage * (depth + 0.16 * audio + shimmer), 0.08, 1);
      }
    }
    if (sub) return packBraille(raster, field, fw, fh);
    return fieldToRaster(raster, field);
  }

  /** Reused field buffer — grow-or-fill, no per-frame allocation. */
  private surfaceField(fw: number, fh: number): Float32Array {
    if (!this.brailleField || this.brailleField.length < fw * fh) {
      this.brailleField = new Float32Array(fw * fh);
    } else {
      this.brailleField.fill(0);
    }
    return this.brailleField;
  }
}

export function rasterAt(raster: OrbRaster, x: number, y: number): OrbCell {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return EMPTY_CELL;
  return raster.cells[y * raster.width + x] ?? EMPTY_CELL;
}

export function normalizedRadius(raster: OrbRaster, x: number, y: number): number {
  if (raster.radiusX <= 0 || raster.radiusY <= 0) return Number.POSITIVE_INFINITY;
  const nx = (x - raster.centerX) / raster.radiusX;
  const ny = (y - raster.centerY) / raster.radiusY;
  return Math.hypot(nx, ny);
}

// ---------------------------------------------------------------------------
// Negative-space surface features (site/orb-braille-source-math-variations.html)
// ---------------------------------------------------------------------------

/**
 * Is this surface point carved out (missing)? Every mode shares the same base
 * wave pattern (listening's traveling grooves) — the mode only selects the
 * color identity downstream. Microphone/voice energy widens the grooves and
 * adds disturbance; muted and silent frames keep the same base wave at its
 * minimum disturbance.
 *
 * `widthScale` maps feature widths to the sample grid: braille subpixels sit
 * 4× closer than terminal cells, so cell-space (glyph) rendering needs wider
 * carve bands to read at all.
 */
function isCarved(nx: number, z: number, lat: number, audio: number, transient: number, t: number, widthScale: number): boolean {
  const lon = Math.atan2(nx, z);
  return carveWave(lat, lon, audio, transient, t, widthScale);
}

/**
 * THE BASE WAVE — traveling latitude grooves (the lab's missingWave/resonance
 * bands), used by every mode. Two tempo waves ripple the ring coordinate while
 * a longitude phase makes the grooves spiral around the sphere, so they read
 * as waves flowing over the surface. Audio deepens the ripple and widens the
 * carving — the visual "disturbance" that ramps with the microphone — while
 * transients add a sharper high-frequency ripple. With audio at zero (silence
 * or muted) the wave keeps traveling at its minimum width.
 */
function carveWave(lat: number, lon: number, audio: number, transient: number, t: number, widthScale: number): boolean {
  const ring = ((lat + Math.PI / 2) / Math.PI) * 14;
  // The time-phase coefficients on `t` set how fast the grooves travel over
  // the sphere: the primary ripple and the counter-propagating component both
  // move their carved bands along the ring coordinate, and the longitude sway
  // spins the spiral — together they read as waves flowing across the surface.
  const w = 0.62 * Math.sin(t * 3.4 - ring * 0.52) + 0.38 * Math.sin(t * 2.0 + ring * 0.83);
  // Disturbance: audio widens the sway; transients add a sharp ripple.
  const sway = w * (0.045 + 0.13 * audio) + transient * 0.05 * Math.sin(lon * 8 - t * 9);
  const displaced = lat + lon * 0.5 * Math.sin(t * 3.1 + ring * 0.7) + sway;
  const d = Math.abs(Math.sin(displaced * 8.1 + lon * 0.5));
  const width = (0.11 + 0.13 * audio + 0.035 * Math.max(0, w) + 0.03 * transient) * widthScale;
  return d < width;
}

/**
 * Braille 8-dot bit order (U+2800 + mask), matching the lab: the left column
 * is dots 1-3 plus the extra 7, the right column dots 4-6 plus 8 — i.e. bits
 * 1,2,4,64 for the 4 left subpixels and 8,16,32,128 for the 4 right ones.
 */
const BRAILLE_BITS = [
  [1, 8],
  [2, 16],
  [4, 32],
  [64, 128],
] as const;

/**
 * Pack a 2×4 subpixel intensity field into one Braille glyph per terminal
 * cell (the lab's rasterizer): a subpixel lights its dot above 0.24, the cell
 * shade/layer come from the brightest lit subpixel.
 */
function packBraille(raster: OrbRaster, field: Float32Array, subW: number, subH: number): OrbRaster {
  const { width, height, cells } = raster;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let mask = 0;
      let max = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const v = field[(y * 4 + dy) * subW + (x * 2 + dx)] ?? 0;
          if (v > 0.24) {
            mask |= BRAILLE_BITS[dy]![dx]!;
            if (v > max) max = v;
          }
        }
      }
      if (!mask) continue;
      const index = y * width + x;
      const shade = clamp(0.16 + 0.84 * max, 0, 1);
      const layer: OrbLayer = max > 0.60 ? "filament" : max > 0.38 ? "mistA" : max > 0.16 ? "mistB" : "mistC";
      cells[index] = {
        ...EMPTY_CELL, coverage: 1, density: max, filament: max > 0.5 ? max : 0, shade, layer,
        glyph: String.fromCharCode(0x2800 + mask),
      };
    }
  }
  return raster;
}

/** Convert the accumulated intensity field into themed glyph cells. */
function fieldToRaster(raster: OrbRaster, field: Float32Array): OrbRaster {
  const { width, height, cells } = raster;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = field[y * width + x]!;
      if (v <= 0.02) continue;
      const index = y * width + x;
      const shade = clamp(0.16 + 0.84 * v, 0, 1);
      const layer: OrbLayer = v > 0.60 ? "filament" : v > 0.38 ? "mistA" : v > 0.16 ? "mistB" : "mistC";
      cells[index] = {
        ...EMPTY_CELL, coverage: 1, density: v, filament: v > 0.5 ? v : 0, shade, layer,
        glyph: pointGlyph(v, x, y),
      };
    }
  }
  return raster;
}

/** Per-cell mark: faint dot for the ghost halo, larger marks toward the core. */
function pointGlyph(v: number, x: number, y: number): string {
  if (v < 0.22) return "·";
  if (v < 0.5) return "∙";
  return ((x + y) & 1) === 0 ? "⋯" : ":";
}

function hash01(x: number, y: number, seed: number): number {
  let h = seed ^ Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 1, 0x85ebca6b);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 0x1_0000_0000;
}

function envelope(current: number, target: number, dt: number, attack: number, release: number): number {
  const tau = target > current ? attack : release;
  const alpha = 1 - Math.exp(-dt / tau);
  return current + (target - current) * alpha;
}
function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
function clamp(value: number, low: number, high: number): number { return Math.max(low, Math.min(high, value)); }
function mod(value: number, divisor: number): number { return ((value % divisor) + divisor) % divisor; }
