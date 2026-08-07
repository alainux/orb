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
  source: VoiceSource;
  /** Continuous animation clock in seconds — always advances (the base wave keeps traveling even while muted). */
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
  private elapsed = 0;
  private transient = 0;
  private prevTarget = 0;

  step(nowMs: number, inputRms: number, outputRms: number, agentSpeaking: boolean, muted = false): OrbFrame {
    if (this.lastMs === 0) this.lastMs = nowMs;
    const dt = clamp((nowMs - this.lastMs) / 1000, 1 / 240, 0.075);
    this.lastMs = nowMs;

    // While muted the mic is dead: the user cannot drive the field, so the
    // base wave keeps traveling but nothing reacts to input. Agent playback
    // keeps animating.
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

    // The base wave animation runs on a continuous clock that never stops:
    // even muted, the carved grooves keep traveling over the sphere (only the
    // audio-driven disturbance and color go dormant).
    this.elapsed += dt;

    let source: VoiceSource = "idle";
    if (this.agentEnergy > 0.035 && this.agentEnergy >= this.userEnergy * 0.9) source = "agent";
    else if (this.userEnergy > 0.025) source = "user";

    return { userEnergy: this.userEnergy, agentEnergy: this.agentEnergy, energy, source, t: this.elapsed, transient: this.transient, muted };
  }
}

export class OrbRenderer {
  private cells: OrbCell[] = [];
  private scratchA: OrbCell[] = [];
  private scratchB: OrbCell[] = [];
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
    const raster = this.prepareRaster(width, height, cellAspect, frame);
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
      return this.renderMode(raster, frame);
    }
    if (this.fadeFrom !== null) {
      const dt = this.clockMs ? clamp((clock - this.clockMs) / 1000, 0, 1) : 0.016;
      this.clockMs = clock;
      this.fadeT = Math.min(1, this.fadeT + dt / ORB_MODE_FADE_SECONDS);
      if (this.fadeT >= 1) {
        this.fadeFrom = null;
      } else {
        const w = smoothstep(0, 1, this.fadeT);
        const fromRaster = this.scratchRaster(raster, this.scratchA);
        const toRaster = this.scratchRaster(raster, this.scratchB);
        this.renderMode(fromRaster, frame);
        this.renderMode(toRaster, frame);
        this.dissolve(fromRaster, toRaster, w);
        return raster;
      }
    } else {
      this.clockMs = clock;
    }
    return this.renderMode(raster, frame);
  }

  /** Set up the raster geometry and reset the shared cell buffer. */
  private prepareRaster(width: number, height: number, cellAspect: number, frame: OrbFrame): OrbRaster {
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
    const radiusEnergy = frame.muted ? 0 : clamp(0.34 + 0.66 * energy, 0, 1);
    const baseRadiusY = maxRadiusY * 0.79;
    const radiusY = Math.min(maxRadiusY * 0.97, baseRadiusY * (1 + 0.105 * radiusEnergy));
    const radiusX = radiusY * cellAspect;
    raster.centerX = (width - 1) / 2;
    raster.centerY = (height - 1) / 2;
    raster.radiusX = radiusX;
    raster.radiusY = radiusY;
    raster.cellAspect = cellAspect;

    const required = width * height;
    if (this.cells.length !== required) this.cells = this.growCells(required);
    else for (let i = 0; i < required; i++) resetCell(this.cells[i]!);
    raster.cells = this.cells;
    return raster;
  }

  /** Grow-or-fill a fresh cell buffer (only on size changes). */
  private growCells(n: number): OrbCell[] {
    return Array.from({ length: n }, () => ({ ...EMPTY_CELL }));
  }

  /**
   * A copy of the raster geometry backed by a REUSED cell buffer (grow-or-
   * fill, reset in place), so a mode crossfade — which renders two extra
   * rasters every tick — stops allocating two full cell arrays per frame.
   */
  private scratchRaster(template: OrbRaster, buffer: OrbCell[]): OrbRaster {
    const required = template.width * template.height;
    if (buffer.length !== required) {
      buffer.length = 0;
      for (let i = 0; i < required; i++) buffer.push({ ...EMPTY_CELL });
    } else {
      for (let i = 0; i < required; i++) resetCell(buffer[i]!);
    }
    return { ...template, cells: buffer };
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
      // Mutate the shared cell in place (no per-cell allocation per fade tick).
      if (ca.glyph && cb.glyph) {
        const x = i % width;
        const y = Math.floor(i / width);
        const flipAt = 0.35 + 0.3 * hash01(x, y, 0x51e17);
        const glyph = w < flipAt ? ca.glyph : cb.glyph;
        const src = glyph === ca.glyph ? ca : cb;
        const target = this.cells[i]!;
        target.coverage = src.coverage;
        target.shade = clamp(ca.shade * fromW + cb.shade * w, 0, 1);
        target.filament = src.filament;
        target.density = src.density;
        target.glyph = src.glyph;
        target.layer = src.layer;
      } else if (ca.glyph) {
        const target = this.cells[i]!;
        target.coverage = ca.coverage;
        target.shade = ca.shade * fromW;
        target.filament = ca.filament;
        target.density = ca.density;
        target.glyph = ca.glyph;
        target.layer = ca.layer;
      } else if (cb.glyph) {
        const target = this.cells[i]!;
        target.coverage = cb.coverage;
        target.shade = cb.shade * w;
        target.filament = cb.filament;
        target.density = cb.density;
        target.glyph = cb.glyph;
        target.layer = cb.layer;
      }
    }
  }

  /** Render the given mode's geometry into the raster's cell buffer. */
  private renderMode(raster: OrbRaster, frame: OrbFrame): OrbRaster {
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
  /** Reused per-braille-cell material texture (object-space grain). */
  private materialCache: Float32Array | undefined;

  /**
   * Surface renderer — the orb's one visual language. Every mode draws the
   * same full sphere of dots (the lab's negative-space technique from
   * site/orb-braille-source-math-variations.html) and carves listening's
   * traveling wave grooves out of it. The sphere is shaded by a real
   * two-light model (a slowly drifting key light with a fixed fill): diffuse
   * terminators put a dark side on the ball, a Phong highlight travels with
   * the light, a fresnel rim lights the silhouette, and a coarse object-space
   * material texture gives the surface a variegated sheen — the orb reads as
   * a lit solid, not a flat circle. Microphone/voice energy widens the carved
   * grooves and, once loud enough, physically pushes the surface: edge points
   * explode outward along their normal and scatter tangentially, and the
   * silhouette breaks apart into bright fringe particles beyond the circle.
   * Muted and silent frames get none of that disturbance — the base wave
   * keeps traveling at its minimum under the same light.
   *
   * The sphere is deliberately NOT rotated as a rigid body: at terminal
   * resolution, rotating point clouds alias into incoherent shimmer. Here the
   * sphere stays fixed and the wave travels over its surface by phase, while
   * only the LIGHT direction drifts — shadows and highlights move without
   * rotating the point cloud, a motion that reads cleanly even in a 2×4
   * subpixel grid.
   *
   * In `sub` mode every terminal cell is split into 2×4 subpixels (Braille);
   * otherwise each cell center is sampled directly (glyph mode). The surface
   * is smooth below the subpixel grid, so per-subpixel shading keeps the look
   * while per-row latitude work keeps the loop fast. The object-space material
   * texture is coarse enough to be evaluated once per braille cell.
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
    // Audio widens the carved grooves and drives the disturbance; muted
    // frames get none of it, so the base wave keeps traveling at its minimum.
    const audio = frame.muted ? 0 : clamp(energy * (0.4 + 0.6 * this.reactivity), 0, 1);
    const transient = frame.muted ? 0 : clamp(frame.transient ?? 0, 0, 1);
    const t = frame.t ?? 0;
    // Disturbance: sustained loudness keeps the surface pushed apart, and
    // attack transients snap it outward on audio peaks.
    const disturb = clamp(Math.max(0, audio - 0.1) * 0.5 + transient * 0.9, 0, 1);
    const lights = orbLights(t);
    const widthScale = sub ? 1 : 4;
    const edge = Math.min(0.18, 0.56 / radiusY);
    const edgeMin = 1 - edge;
    const edgeMax = 1 + edge;
    const edgeMin2 = edgeMin * edgeMin;
    const edgeMax2 = edgeMax * edgeMax;
    const outer = 1 + disturb * 0.55;
    const outer2 = outer * outer;
    // The explode is a rim effect: displacement for interior points is
    // imperceptible, so they stay on the quiet path (and the breakup ramps in
    // smoothly from r≈0.5), keeping loud renders near the cost of quiet ones.
    const disturbInner2 = 0.25;
    // Material texture for braille: coarse object-space grain evaluated once
    // per terminal cell (the 2×4 subpixels of one cell sit too close together
    // to matter for a texture this large), so braille keeps ~all its speed.
    const material = sub ? this.cellMaterial(raster, cx, cy, radiusX, radiusY, edgeMax2) : undefined;
    for (let fy = 0; fy < fh; fy++) {
      const ny = (fy - cy) / radiusY;
      const lat0 = Math.asin(clamp(ny, -1, 1));
      const row = fy * fw;
      for (let fx = 0; fx < fw; fx++) {
        const nx = (fx - cx) / radiusX;
        const r2 = nx * nx + ny * ny;
        if (disturb > 0.001 && r2 >= disturbInner2) {
          // Disturbance: loud audio physically breaks the surface apart.
          // Edge points explode outward along their normal and scatter
          // tangentially (noise-shaped, so the breakup is irregular, not a
          // ring), and points that blow past the silhouette survive as
          // fringe particles beyond the circle — the orb's rim visually
          // fragments on audio peaks.
          if (r2 >= outer2) continue;
          const r = Math.sqrt(r2);
          const edgeF = smoothstep(0.12, 1, r);
          // Ramp the breakup in smoothly toward the interior so the disturbed
          // region blends into the untouched center without a seam.
          const ramp = smoothstep(0.5, 0.7, r);
          const noise =
            0.58 * (0.5 + 0.5 * Math.sin(nx * 10.5 - ny * 7.4 + t * 10.8)) +
            0.42 * (0.5 + 0.5 * Math.sin(nx * 17 + ny * 9 - t * 13.2));
          const radial = disturb * ramp * (0.02 + 0.22 * edgeF) * (0.45 + 0.55 * noise);
          const tangent = disturb * ramp * 0.1 * (0.25 + 0.75 * edgeF) * Math.sin(nx * 9 + ny * 6.5 + t * 15);
          const wobble = disturb * ramp * 0.035 * Math.sin((nx - ny) * 11 - t * 9);
          const inv = r > 1e-5 ? 1 / r : 1;
          const ux = nx * inv;
          const uy = ny * inv;
          const tx = -uy;
          const ty = ux;
          const xs = nx + ux * radial + tx * tangent;
          const ys = ny + uy * (radial * 0.95 + wobble) + ty * (tangent * 0.35);
          const rs2 = xs * xs + ys * ys;
          if (rs2 <= 1) {
            let coverage = 1;
            if (rs2 > edgeMin2) {
              coverage = 1 - smoothstep(edgeMin, edgeMax, Math.sqrt(rs2));
              if (coverage <= 0.02) continue;
            }
            const z = Math.sqrt(Math.max(0, 1 - rs2));
            const lat = Math.asin(clamp(ys, -1, 1));
            const lon = Math.atan2(xs, z);
            if (carveWave(lat, lon, audio, transient, t, widthScale)) continue;
            const mat = material ? material[(fy >> 2) * raster.width + (fx >> 1)]! : materialOf(lat, lon);
            field[row + fx] = clamp(coverage * orbLighting(xs, ys, z, lights, mat, audio, transient, t), 0.05, 1);
          } else if (rs2 <= outer2) {
            // Fringe particle: this point blew past the silhouette. Clamp it
            // back onto the sphere and keep it as a bright rim fragment whose
            // strength fades with how far it escaped.
            const rs = Math.sqrt(rs2);
            const band = 1 - (rs - 1) / (outer - 1);
            const chance = band * (0.52 + 0.48 * noise) + disturb * 0.22;
            if (chance > 0.46) {
              const c = 0.985 / Math.max(1e-5, rs);
              const px = xs * c;
              const py = ys * c;
              const pz = Math.sqrt(Math.max(0, 1 - px * px - py * py));
              const lat = Math.asin(clamp(py, -1, 1));
              const lon = Math.atan2(px, pz);
              const mat = material ? material[(fy >> 2) * raster.width + (fx >> 1)]! : materialOf(lat, lon);
              const lit = orbLighting(px, py, pz, lights, mat, audio, transient, t);
              field[row + fx] = clamp(band * (0.55 + 0.45 * band) * lit + 0.04, 0.05, 1);
            }
          }
          continue;
        }
        // Quiet path: silent frames, or the undisturbed interior of a loud
        // frame — no displacement, keep it as cheap as possible.
        if (r2 >= edgeMax2) continue;
        let coverage = 1;
        if (r2 > edgeMin2) {
          coverage = 1 - smoothstep(edgeMin, edgeMax, Math.sqrt(r2));
          if (coverage <= 0.02) continue;
        }
        const z = Math.sqrt(Math.max(0, 1 - r2));
        const lon = Math.atan2(nx, z);
        if (carveWave(lat0, lon, audio, transient, t, widthScale)) continue;
        const mat = material ? material[(fy >> 2) * raster.width + (fx >> 1)]! : materialOf(lat0, lon);
        field[row + fx] = clamp(coverage * orbLighting(nx, ny, z, lights, mat, audio, transient, t), 0.05, 1);
      }
    }
    if (sub) return packBraille(raster, field, fw, fh);
    return fieldToRaster(raster, field);
  }

  /**
   * Coarse object-space material texture per braille cell, computed at each
   * cell's center subpixel. The texture is a couple of low-frequency sines in
   * the sphere's own coordinates, so it reads as static surface grain (never
   * rotating with the light) and gives the otherwise-smooth shading a touch
   * of personality.
   */
  private cellMaterial(raster: OrbRaster, cx: number, cy: number, radiusX: number, radiusY: number, edgeMax2: number): Float32Array {
    if (!this.materialCache || this.materialCache.length < raster.width * raster.height) {
      this.materialCache = new Float32Array(raster.width * raster.height);
    }
    const m = this.materialCache;
    for (let y = 0; y < raster.height; y++) {
      const ny = (y * 4 + 2 - cy) / radiusY;
      const lat = ny < -1 || ny > 1 ? 0 : Math.asin(ny);
      for (let x = 0; x < raster.width; x++) {
        const nx = (x * 2 + 1 - cx) / radiusX;
        const r2 = nx * nx + ny * ny;
        m[y * raster.width + x] = r2 >= edgeMax2 ? 0.5 : materialOf(lat, Math.atan2(nx, Math.sqrt(Math.max(0, 1 - r2))));
      }
    }
    return m;
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
 * THE BASE WAVE — traveling latitude grooves (the lab's missingWave/resonance
 * bands), used by every mode. Two tempo waves ripple the ring coordinate while
 * a longitude phase makes the grooves spiral around the sphere, so they read
 * as waves flowing over the surface. Audio deepens the ripple and widens the
 * carving — the visual "disturbance" that ramps with the microphone — while
 * transients add a sharper high-frequency ripple. With audio at zero (silence
 * or muted) the wave keeps traveling at its minimum width.
 *
 * `widthScale` maps feature widths to the sample grid: braille subpixels sit
 * 4× closer than terminal cells, so cell-space (glyph) rendering needs wider
 * carve bands to read at all.
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
 * Per-frame light rig. The key light drifts slowly (a sway in azimuth and
 * elevation) so the sphere's shadows and Phong highlight travel with it —
 * the orb feels lit by a live source, not a static icon — while the fixed
 * fill light from the front-low opposite side keeps the dark side readable.
 * Only the light moves; the sphere itself never rotates. The result is
 * written into a module-level object (single-threaded) so a render allocates
 * no per-frame light object.
 */
const ORB_LIGHTS: { kx: number; ky: number; kz: number; fx: number; fy: number; fz: number } = { kx: 0, ky: 0, kz: 0, fx: 0, fy: 0, fz: 0 };
function orbLights(t: number): { kx: number; ky: number; kz: number; fx: number; fy: number; fz: number } {
  // A deliberately lateral key: the z component stays high enough to light the
  // front of the sphere, but the strong leftward bias puts the right side into
  // a real terminator shadow, so the disk reads as a lit ball rather than a
  // uniformly bright circle. The drift sways the shadow and highlight.
  const lx = -0.68 + 0.14 * Math.cos(t * 0.31);
  const ly = -0.3 + 0.12 * Math.sin(t * 0.23);
  const lz = 0.66;
  const lk = Math.hypot(lx, ly, lz);
  const fl = Math.hypot(0.32, 0.12, 0.94);
  ORB_LIGHTS.kx = lx / lk;
  ORB_LIGHTS.ky = ly / lk;
  ORB_LIGHTS.kz = lz / lk;
  ORB_LIGHTS.fx = 0.32 / fl;
  ORB_LIGHTS.fy = 0.12 / fl;
  ORB_LIGHTS.fz = 0.94 / fl;
  return ORB_LIGHTS;
}

/**
 * Two-light shading of a unit surface point: key diffuse + terminator
 * darkening (the shadow side), fill diffuse, a tight Phong highlight from
 * the reflected key ray, fresnel rim light along the silhouette, and the
 * object-space material grain. The coefficients are deliberately high-
 * contrast: a strong key, a weak fill, and a deep terminator put a clearly
 * lit side against a clearly dark side, so the sphere reads as a solid ball
 * even at 2×4 subpixel resolution. Audio brightens the whole surface and
 * transients add a sharp shimmer.
 */
function orbLighting(nx: number, ny: number, z: number, l: { kx: number; ky: number; kz: number; fx: number; fy: number; fz: number }, material: number, audio: number, transient: number, t: number): number {
  const kd = nx * l.kx + ny * l.ky + z * l.kz;
  const keyDiff = Math.max(0, kd);
  const fillDiff = Math.max(0, nx * l.fx + ny * l.fy + z * l.fz);
  const terminator = Math.max(0, -kd);
  // Phong highlight: the reflected key ray dotted with the view (0,0,1), i.e.
  // the z component of reflect(-key, n). Power 40 = x^32·x^8, kept as
  // multiplies so the hot spot costs less than a Math.pow call.
  const d = -l.kx * nx - l.ky * ny - l.kz * z;
  const rz = -l.kz - 2 * d * z;
  const s = Math.max(0, rz);
  const s2 = s * s;
  const s4 = s2 * s2;
  const s8 = s4 * s4;
  const s16 = s8 * s8;
  const s32 = s16 * s16;
  const specular = s32 * s8;
  // Fresnel rim ≈ (1-z)^1.6 via three multiplies (a slightly lifted square):
  // u^1.6 sits between u and u^2, so u²·(1.25 − 0.25u) lands within a few
  // percent across [0,1] and avoids a Math.pow per sample.
  const u = 1 - Math.max(0, z);
  const rim = u * u * (1.25 - 0.25 * u);
  const shimmer = 0.05 * Math.sin(nx * 11 + ny * 7 + t * 2.6);
  const flare = 0.09 * transient * Math.sin(nx * 17 - t * 29);
  return 0.05 + 0.72 * keyDiff + 0.09 * fillDiff - 0.2 * terminator + 0.3 * specular + 0.16 * rim + 0.18 * material + 0.16 * audio + shimmer + flare;
}

/** Coarse object-space surface grain (the demo's material field, trimmed). */
function materialOf(lat: number, lon: number): number {
  return clamp(0.5 + 0.16 * Math.sin(lon * 2 + lat * 0.76) + 0.08 * Math.cos(lon * 3 - lat * 1.42 + 1.1), 0, 1);
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

/** All 256 braille glyphs precomputed — no per-cell string allocation. */
const BRAILLE_GLYPHS: string[] = Array.from({ length: 256 }, (_, mask) => String.fromCharCode(0x2800 + mask));

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
      // Mutate the shared cell in place — no per-cell object allocation.
      const target = cells[index]!;
      target.coverage = 1;
      target.density = max;
      target.filament = max > 0.5 ? max : 0;
      target.shade = shade;
      target.layer = layer;
      target.glyph = BRAILLE_GLYPHS[mask]!;
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
      // Mutate the shared cell in place — no per-cell object allocation.
      const target = cells[index]!;
      target.coverage = 1;
      target.density = v;
      target.filament = v > 0.5 ? v : 0;
      target.shade = shade;
      target.layer = layer;
      target.glyph = pointGlyph(v, x, y);
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
/** Reset a cell in place (no allocation) — keeps the per-frame cell churn at zero. */
function resetCell(c: OrbCell): void {
  c.coverage = 0;
  c.shade = 0;
  c.filament = 0;
  c.density = 0;
  c.glyph = "";
  c.layer = "none";
}
function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
function clamp(value: number, low: number, high: number): number { return Math.max(low, Math.min(high, value)); }
