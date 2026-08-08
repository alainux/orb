import type { VoiceSource } from "./types.js";

export type OrbLayer = "none" | "mistA" | "mistB" | "mistC" | "filament";

/**
 * Orb animation states. Every mode renders the same living sphere — a fluid,
 * domain-warped particle field whose color is a signed noise field over the
 * surface (see the site labs: site/orb-3d.html's two-energy-region listening
 * look, site/presence.html's soul signature). The modes differ in motion
 * parameters (speed/breath/warp/edge/glow) and color behavior in widget.ts:
 * `smoke` (idle) is the calm continuous presence drift, `composing` (talking)
 * the audio-reactive two-region sphere with white pressure blooms, and
 * `searching` (thinking) the calmer look with a broad cognition pulse
 * sweeping the sphere. The sphere is never rotated as a rigid body — the
 * noise fields travel by the clock phase instead.
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
  /**
   * Energy-anchor selector 0..1: where the cell sits on the signed
   * domain-warped field that colors the sphere. The widget maps it onto the
   * theme's two energy anchors (primary accent → secondary violet) with a
   * mode-dependent boundary feather — 0 and 1 are the two pure anchors, and
   * values near 0.5 sit on the drifting boundary between regions.
   */
  identity: number;
}

export interface OrbFrame {
  userEnergy: number;
  agentEnergy: number;
  energy: number;
  source: VoiceSource;
  /** Continuous animation clock in seconds — always advances (the noise fields keep flowing even while muted). */
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

const EMPTY_CELL: OrbCell = Object.freeze({ coverage: 0, shade: 0, filament: 0, density: 0, glyph: "", layer: "none", identity: 0 });

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
    // noise keeps flowing but nothing reacts to input. Agent playback keeps
    // animating.
    const userTarget = muted ? 0 : clamp((inputRms - 0.006) / 0.12, 0, 1);
    let agentTarget = clamp((outputRms - 0.0035) / 0.17, 0, 1);
    if (agentSpeaking && agentTarget < 0.1) agentTarget = 0.1;
    if (!agentSpeaking && agentTarget < 0.018) agentTarget = 0;

    this.userEnergy = envelope(this.userEnergy, userTarget, dt, 0.045, 0.34);
    this.agentEnergy = envelope(this.agentEnergy, agentTarget, dt, 0.04, 0.28);
    const energy = Math.max(this.userEnergy, this.agentEnergy);

    // Attack transient (from the lab): spikes on sharp audio onsets and decays
    // at ~8/s, driving the sharper pressure waves of the audio-reactive modes.
    const rawTarget = Math.max(userTarget, agentTarget, Math.sqrt((userTarget * userTarget + agentTarget * agentTarget) * 0.55));
    const rawDelta = Math.max(0, rawTarget - this.prevTarget);
    this.transient = Math.max(rawDelta * 2.7, this.transient * Math.exp(-dt * 8));
    this.prevTarget = rawTarget;

    // The base field animation runs on a continuous clock that never stops:
    // even muted, the domain-warped noise keeps flowing over the sphere (only
    // the audio-driven response and color go dormant).
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
  /** Center-to-edge pressure waves (the labs' pulses), born on audio onsets. */
  private pulses: OrbPulse[] = [];
  private lastPulseT = -10;
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

    // Pressure waves: sharp audio onsets (attack transients) birth center-to-
    // edge pulses whose shell/core/edge contributions drive the audio bloom
    // and the particle halo. A refractory window stops machine-gun rings.
    // The queue is clock-driven, so identical render sequences stay
    // deterministic (the labs' flux-triggered excitation).
    if (frame.t !== undefined) this.updatePulses(frame.t, frame);

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
      return this.renderMode(raster, frame, this.lastMode);
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
        this.renderMode(fromRaster, frame, this.fadeFrom);
        this.renderMode(toRaster, frame, this.lastMode);
        this.dissolve(fromRaster, toRaster, w);
        return raster;
      }
    } else {
      this.clockMs = clock;
    }
    return this.renderMode(raster, frame, this.lastMode);
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
    // Muted is exempt — the field keeps flowing at its minimum, but the
    // sphere stays compact rather than breathing with the room. The base
    // radius leaves headroom for the particle halo (pattern radius ~1.26),
    // so the sparse rim particles stay inside the panel.
    const radiusEnergy = frame.muted ? 0 : clamp(0.34 + 0.66 * energy, 0, 1);
    const baseRadiusY = maxRadiusY * 0.78;
    const radiusY = Math.min(maxRadiusY * 0.8, baseRadiusY * (1 + 0.1 * radiusEnergy));
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
   * fade their intensity in/out — a dissolve rather than a cut. The identity
   * and bloom channels crossfade with the shade so the color identity morphs
   * in step with the geometry.
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
        target.identity = clamp(ca.identity * fromW + cb.identity * w, 0, 1);
        target.filament = clamp(ca.filament * fromW + cb.filament * w, 0, 1);
        target.density = src.density;
        target.glyph = src.glyph;
        target.layer = src.layer;
      } else if (ca.glyph) {
        const target = this.cells[i]!;
        target.coverage = ca.coverage;
        target.shade = ca.shade * fromW;
        target.identity = ca.identity;
        target.filament = ca.filament;
        target.density = ca.density;
        target.glyph = ca.glyph;
        target.layer = ca.layer;
      } else if (cb.glyph) {
        const target = this.cells[i]!;
        target.coverage = cb.coverage;
        target.shade = cb.shade * w;
        target.identity = cb.identity;
        target.filament = cb.filament;
        target.density = cb.density;
        target.glyph = cb.glyph;
        target.layer = cb.layer;
      }
    }
  }

  /** Render the given mode's geometry into the raster's cell buffer. */
  private renderMode(raster: OrbRaster, frame: OrbFrame, mode: OrbMode): OrbRaster {
    if (this.braille) return this.renderSurface(raster, frame, mode, true);
    return this.renderSurface(raster, frame, mode, false);
  }

  /** Reused per-cell buffers — no per-frame allocation. */
  private cellRadius: Float32Array | undefined;
  private cellIdentity: Float32Array | undefined;
  private cellIntensity: Float32Array | undefined;
  private cellBloom: Float32Array | undefined;
  private cellEdge: Float32Array | undefined;

  /**
   * Surface renderer — the orb's one visual language, ported from the new
   * site labs (site/orb-3d.html's fluid listening field, site/presence.html's
   * soul signature). The sphere is a positive-space particle field:
   *
   *  - SHAPE: a breathing, gently drifting, slightly squashed disk whose edge
   *    is deformed by a seamless circular fBm (noise sampled on cos/sin of the
   *    angle, so there is no preferred rotation direction). Interior sample
   *    coordinates are displaced by a domain-warped flow field (nested fBm),
   *    weighted toward the surface so the internal currents read through the
   *    shading.
   *  - COLOR: a signed domain-warped fBm field over the surface picks each
   *    cell's identity between two energy anchors (primary ↔ secondary, see
   *    widget.ts). Composing holds a crisp two-region boundary; smoke drifts
   *    continuously; searching reads mid-way with a broad cognition pulse
   *    sweeping the longitude (the labs' thinking sweep).
   *  - LIGHT: the same two-light rig as before (drifting key + fixed fill +
   *    Phong highlight + fresnel rim), but audio is luminance-first: mic
   *    energy brightens the core and adds a near-white pressure bloom driven
   *    by the pulse shell/core — the labs' listening look.
   *  - HALO: outside the body a sparse particle halo lives (d up to ~1.26);
   *    almost absent at rest, it blooms as a pressure pulse reaches the edge
   *    and brightens with signal.
   *  - DITHER: braille packs 2×4 subpixels per terminal cell with an 8×8
   *    Bayer threshold — dot density conveys the shading instead of a fixed
   *    0.24 cutoff.
   *
   * The sphere is deliberately NOT rotated as a rigid body: at terminal
   * resolution, rotating point clouds alias into incoherent shimmer. Only the
   * noise fields, the boundary, the sweep, and the light direction travel by
   * clock phase. Muted frames get no audio terms (no pulses, no bloom) but
   * the base field keeps flowing at its minimum.
   *
   * Expensive noise is sampled once per terminal cell (subpixels within a
   * cell are far below the noise scales that matter), while the per-subpixel
   * pass stays cheap: d (inside/outside + halo), the Bayer threshold, and the
   * sparse halo grain. That keeps braille within the widget's frame budget.
   */
  private renderSurface(raster: OrbRaster, frame: OrbFrame, mode: OrbMode, sub: boolean): OrbRaster {
    const t = frame.t ?? 0;
    const audio = frame.muted ? 0 : clamp(frame.energy * (0.4 + 0.6 * this.reactivity), 0, 1);
    const params = modeMotion(mode);
    // Cell-wide geometry + material: radius (breathing + seamless circular
    // fBm edge), flow-warped coordinates, identity field, lighting/bloom,
    // and the pulse edge that drives the halo.
    this.computeCells(raster, frame, params, audio, t, mode);
    if (sub) return this.packBraille(raster, t, audio);
    return this.packGlyphs(raster, t, audio);
  }

  /**
   * Braille pack: one terminal cell holds 2×4 subpixels; each subpixel lights
   * its dot when the shaped intensity beats the 8×8 Bayer threshold (density-
   * adjusted), so the shading reads as ordered-dithered dot density. Cells on
   * the halo band sample sparse particles instead of the body. The cell's
   * identity/bloom are averaged over its sampled subpixels; shade comes from
   * the brightest lit subpixel.
   */
  private packBraille(raster: OrbRaster, t: number, audio: number): OrbRaster {
    const { width, height, cells, centerX, centerY, radiusX, radiusY } = raster;
    const radius = this.cellRadius!;
    const identity = this.cellIdentity!;
    const intensity = this.cellIntensity!;
    const bloom = this.cellBloom!;
    const edge = this.cellEdge!;
    const densityOffset = 0.05 * (this.densityScale - 1);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        const cellRadius = radius[index] ?? 0;
        if (cellRadius <= 0) continue;
        const cellEdge = edge[index] ?? 0;
        let mask = 0;
        let count = 0;
        let sumIdentity = 0;
        let sumBloom = 0;
        let max = 0;
        for (let dy = 0; dy < 4; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const gx = x * 2 + dx;
            const gy = y * 4 + dy;
            const nx = (gx - centerX * 2) / (radiusX * 2);
            const ny = (gy - centerY * 4) / (radiusY * 4);
            const d = Math.hypot(nx, ny) / cellRadius;
            if (d > 1.26) continue;
            let v: number;
            let id: number;
            let bl: number;
            if (d > 1) {
              // Sparse particle halo — per-subpixel so it reads as particles.
              const halo = 1 - (d - 1) / 0.26;
              const particleEnergy = clamp(0.02 + audio * 0.03 + cellEdge * 1.18);
              const drift = fbm3(nx * 7.2 + t * 0.08, ny * 7.2 - t * 0.06, t * 0.28 + 3.4, 3);
              const grain = 0.5 + 0.5 * fbm3(nx * 14 - 2.7, ny * 14 + 6.1, t * 0.5, 2);
              const particle = 0.62 * (0.5 + 0.5 * drift) + 0.38 * grain;
              const threshold = 0.915 - particleEnergy * 0.34;
              if (particle < threshold) continue;
              const sparkle = clamp((particle - threshold) / (1 - threshold + 0.0001));
              v = (0.14 + 0.62 * particleEnergy) * halo * (0.42 + 0.58 * sparkle);
              id = clamp(0.5 + 0.5 * drift);
              bl = clamp(0.15 + 0.6 * sparkle);
            } else {
              v = intensity[index] ?? 0;
              id = identity[index] ?? 0;
              bl = bloom[index] ?? 0;
            }
            const shaped = clamp((v - 0.34) * 1.43 + 0.5);
            if (shaped > (BAYER8[gy & 7]![gx & 7]! + 0.5) / 64 - densityOffset) mask |= BRAILLE_BITS[dy]![dx]!;
            count++;
            sumIdentity += id;
            sumBloom += bl;
            if (v > max) max = v;
          }
        }
        if (!mask) continue;
        const target = cells[index]!;
        target.coverage = 1;
        target.density = max;
        target.filament = count ? clamp(sumBloom / count, 0, 1) : 0;
        target.shade = clamp(0.16 + 0.84 * max, 0, 1);
        target.layer = max > 0.6 ? "filament" : max > 0.38 ? "mistA" : max > 0.16 ? "mistB" : "mistC";
        target.identity = count ? clamp(sumIdentity / count, 0, 1) : 0.5;
        target.glyph = BRAILLE_GLYPHS[mask]!;
      }
    }
    return raster;
  }

  /**
   * Glyph-mode pack: one sample per terminal cell at its center; the cell
   * mark scales with the sample intensity. Halo cells sample a single
   * particle.
   */
  private packGlyphs(raster: OrbRaster, t: number, audio: number): OrbRaster {
    const { width, height, cells, centerX, centerY, radiusX, radiusY } = raster;
    const radius = this.cellRadius!;
    const identity = this.cellIdentity!;
    const intensity = this.cellIntensity!;
    const bloom = this.cellBloom!;
    const edge = this.cellEdge!;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        const cellRadius = radius[index] ?? 0;
        if (cellRadius <= 0) continue;
        const nx = (x + 0.5 - centerX) / radiusX;
        const ny = (y + 0.5 - centerY) / radiusY;
        const d = Math.hypot(nx, ny) / cellRadius;
        if (d > 1.26) continue;
        let v: number;
        let id: number;
        let bl: number;
        if (d > 1) {
          const halo = 1 - (d - 1) / 0.26;
          const particleEnergy = clamp(0.02 + audio * 0.03 + (edge[index] ?? 0) * 1.18);
          const drift = fbm3(nx * 7.2 + t * 0.08, ny * 7.2 - t * 0.06, t * 0.28 + 3.4, 3);
          const grain = 0.5 + 0.5 * fbm3(nx * 14 - 2.7, ny * 14 + 6.1, t * 0.5, 2);
          const particle = 0.62 * (0.5 + 0.5 * drift) + 0.38 * grain;
          const threshold = 0.915 - particleEnergy * 0.34;
          if (particle < threshold) continue;
          const sparkle = clamp((particle - threshold) / (1 - threshold + 0.0001));
          v = (0.14 + 0.62 * particleEnergy) * halo * (0.42 + 0.58 * sparkle);
          id = clamp(0.5 + 0.5 * drift);
          bl = clamp(0.15 + 0.6 * sparkle);
        } else {
          v = intensity[index] ?? 0;
          id = identity[index] ?? 0;
          bl = bloom[index] ?? 0;
        }
        if (v <= 0.02) continue;
        const target = cells[index]!;
        target.coverage = 1;
        target.density = v;
        target.filament = clamp(bl, 0, 1);
        target.shade = clamp(0.16 + 0.84 * v, 0, 1);
        target.layer = v > 0.6 ? "filament" : v > 0.38 ? "mistA" : v > 0.16 ? "mistB" : "mistC";
        target.identity = clamp(id, 0, 1);
        target.glyph = pointGlyph(v, x, y);
      }
    }
    return raster;
  }

  /**
   * Per-cell geometry + material pass (one sample per terminal cell at its
   * center): the breathing radius with the seamless circular fBm edge, the
   * domain-warped flow displacement, the identity field, the two-light
   * shading, the audio pressure bloom, and the thinking sweep. Everything
   * below the noise scales is constant across a cell's 2×4 subpixels, so the
   * per-subpixel pass only re-derives d, the Bayer threshold, and halo grain.
   */
  private computeCells(raster: OrbRaster, frame: OrbFrame, params: OrbMotionParams, audio: number, t: number, mode: OrbMode): void {
    const { width, height, centerX, centerY, radiusX, radiusY } = raster;
    const n = width * height;
    this.cellRadius = growF32(this.cellRadius, n);
    this.cellIdentity = growF32(this.cellIdentity, n);
    this.cellIntensity = growF32(this.cellIntensity, n);
    this.cellBloom = growF32(this.cellBloom, n);
    this.cellEdge = growF32(this.cellEdge, n);
    const radius = this.cellRadius!;
    const identityOut = this.cellIdentity!;
    const intensityOut = this.cellIntensity!;
    const bloomOut = this.cellBloom!;
    const edgeOut = this.cellEdge!;
    const muted = frame.muted === true;

    // Global drift and squash — pure time functions (the labs' shape terms).
    const driftX = 0.02 * fbm3(0.3, 0.7, t * 0.065, 3) + 0.01 * Math.sin(t * 0.17 + 0.4);
    const driftY = 0.02 * fbm3(7.1, 2.6, t * 0.061 + 4.3, 3) + 0.009 * Math.cos(t * 0.15 + 0.9);
    const squash = 0.018 * fbm3(1.2, 8.4, t * 0.072, 3) + params.energy * 0.008 * Math.sin(t * 0.33);
    const listenGain = mode === "composing" ? 1 : mode === "searching" ? 0.62 : 0.28;
    const breathing = params.breath * (0.45 + 0.55 * Math.sin(t * (0.48 + params.speed * 0.2))) + (mode === "composing" ? audio * 0.015 : 0);

    const key = normalize3(-0.68, -0.56, 1.0);
    const fill = normalize3(0.45, 0.16, 0.72);
    const specDir = normalize3(-0.31, -0.25, 1.0);

    for (let y = 0; y < height; y++) {
      const nyc = (y + 0.5 - centerY) / radiusY;
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const nxc = (x + 0.5 - centerX) / radiusX;
        // Shape: drift, squash, then the seamless circular fBm edge.
        const px = nxc - driftX;
        const py = nyc - driftY;
        const sx = px / (1 + squash);
        const sy = py / (1 - squash * 0.72);
        const rawR = Math.hypot(sx, sy);
        const circleX = rawR > 1e-6 ? sx / rawR : 1;
        const circleY = rawR > 1e-6 ? sy / rawR : 0;
        const edgeTime = t * (0.055 + params.speed * 0.12);
        const edgeLow = fbm3(circleX * 1.23 + 2.8, circleY * 1.23 - 4.1, edgeTime, 4);
        const edgeHigh = fbm3(circleX * 2.35 - 6.7, circleY * 2.35 + 1.9, edgeTime * 1.31 + 5.4, 3);
        const surfaceR = 1 + breathing + params.edge * (edgeLow * 0.92 + edgeHigh * 0.34);
        const d = rawR / surfaceR;
        radius[row + x] = d > 1.26 ? 0 : surfaceR;
        if (d > 1.26) continue;

        // Pulse edge at this cell's radius — drives the halo bloom.
        edgeOut[row + x] = pulseInfo(this.pulses, t, Math.min(d, 1.25)).edge;

        // Flow-warped interior sample (displacement toward the surface).
        const falloff = Math.pow(clamp(1 - d), 0.42);
        const flow = flowFieldAt(sx, sy, params, t);
        const warp = params.warp * listenGain;
        const wx = sx + warp * (flow.x * 0.92 + flow.qy * 0.22) * falloff;
        const wy = sy + warp * (flow.y * 0.92 - flow.qx * 0.2) * falloff;
        const id = Math.hypot(wx, wy) / surfaceR;
        const z = Math.sqrt(Math.max(0, 1 - Math.min(1, id * id)));
        const normal = normalize3(wx / surfaceR, wy / surfaceR, z + 0.08);

        // Identity: signed domain-warped fBm field → energy-anchor selector.
        identityOut[row + x] = identityFieldAt(wx, wy, params, t);

        // Two-light shading (the labs' listening lighting).
        const kd = Math.max(0, dot3(normal, key));
        const fd = Math.max(0, dot3(normal, fill));
        const spec = Math.pow(Math.max(0, dot3(normal, specDir)), 20);
        const zc = clamp(z, 0, 1);

        // Pulse shell/core at this cell's radius (audio pressure waves).
        const pulse = pulseInfo(this.pulses, t, Math.min(d, 1.25));

        let intensity = 0.18 + 0.43 * kd + 0.15 * fd + 0.18 * zc + 0.07 * params.glow + spec * 0.16;
        let bloom = clamp(Math.pow(zc, 4) * (0.07 + 0.11 * params.glow) + Math.pow(kd, 4.5) * (0.13 + 0.2 * params.glow) + spec * (0.1 + 0.24 * params.glow), 0, 0.965);

        if (mode === "composing") {
          // Audio is luminance-first: bright core, then an unmistakable
          // near-white pressure shell from the pulse waves.
          bloom += audio * (0.045 + 0.13 * Math.pow(zc, 2.6)) + Math.pow(pulse.shell, 0.72) * 0.76 + Math.pow(pulse.core, 0.78) * 0.62;
          intensity += audio * (0.055 + 0.1 * Math.pow(zc, 2.4)) + Math.pow(pulse.shell, 0.7) * 0.7 + Math.pow(pulse.core, 0.76) * 0.44;
        } else if (mode === "searching") {
          // Thinking: a broad cognition pulse sweeps the longitude meridian.
          const sweep = thinkingSweep(normal, t);
          intensity += sweep.band * 0.48 + sweep.aura * 0.085 + sweep.trailing * 0.055;
          bloom += clamp(sweep.band * 0.72 + sweep.aura * 0.1 + sweep.trailing * 0.075, 0, 0.8);
        }

        if (muted) {
          // Quiet presence: dimmed body, no bloom — the widget renders it gray.
          intensity *= 0.57;
          bloom *= 0.35;
        }

        // Depth / roundness: darken toward the rim (the lab's edge shading
        // "mix(color, deep, edgeShade)"), so the sphere reads as a lit ball
        // instead of a uniform bright disk — the depth cue also keeps the
        // idle smoke from boiling into an even, over-bright glow.
        const edgeDepth = 1 - clamp((d - 0.61) / 0.46, 0, 1) * (muted ? 0.58 : 0.34);

        intensityOut[row + x] = clamp(intensity * edgeDepth, 0, 1);
        bloomOut[row + x] = clamp(bloom * edgeDepth, 0, 1);
      }
    }
  }

  /**
   * Birth and prune pressure pulses. A pulse is born when the attack
   * transient spikes (audio onset) and the refractory window has passed —
   * the labs' "positive audio flux creates discrete pressure waves". The
   * jitter is derived from a hash of the clock, so the queue is deterministic
   * for identical render sequences. Muted frames never birth pulses.
   */
  private updatePulses(t: number, frame: OrbFrame): void {
    const transient = frame.muted ? 0 : clamp(frame.transient ?? 0, 0, 1);
    if (transient > 0.4 && t - this.lastPulseT > 0.16) {
      const h = hash01(Math.round(t * 50), this.pulses.length, 0x51e17);
      this.pulses.push({
        born: t,
        amp: clamp(0.34 + transient * 0.6, 0.3, 1),
        speed: 0.58 + h * 0.14,
        width: 0.09 + h * 0.038,
        drift: (hash01(Math.round(t * 50), this.pulses.length + 1, 0x61e17) - 0.5) * 0.14,
        seed: h * 20,
      });
      this.lastPulseT = t;
      if (this.pulses.length > 10) this.pulses.splice(0, this.pulses.length - 10);
    }
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      if (t - this.pulses[i]!.born > 2.45) this.pulses.splice(i, 1);
    }
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
// Per-mode motion parameters (the labs' state vocabulary)
// ---------------------------------------------------------------------------

interface OrbMotionParams {
  speed: number;
  breath: number;
  warp: number;
  edge: number;
  glow: number;
  energy: number;
}

/**
 * The labs define each state by a small set of motion parameters. Our three
 * modes map onto the new site orbs' states: smoke ≈ presence (quiet, slow),
 * composing ≈ listening (fast, warped, glowy, audio-driven), searching ≈
 * thinking (fast field with the cognition sweep).
 */
function modeMotion(mode: OrbMode): OrbMotionParams {
  switch (mode) {
    case "composing":
      return { speed: 0.3, breath: 0.047, warp: 0.118, edge: 0.058, glow: 1.0, energy: 0.74 };
    case "searching":
      return { speed: 0.42, breath: 0.03, warp: 0.072, edge: 0.038, glow: 0.74, energy: 0.44 };
    default:
      return { speed: 0.12, breath: 0.014, warp: 0.026, edge: 0.018, glow: 0.34, energy: 0.08 };
  }
}

// ---------------------------------------------------------------------------
// Seeded Perlin noise + fBm (the labs' field language)
// ---------------------------------------------------------------------------

const PERM = (() => {
  const base = Array.from({ length: 256 }, (_, i) => i);
  let seed = 0x9e3779b9;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const temp = base[i]!;
    base[i] = base[j]!;
    base[j] = temp;
  }
  return [...base, ...base];
})();

const fade = (n: number) => n * n * n * (n * (n * 6 - 15) + 10);
function grad(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

/** Seeded improved Perlin noise — smooth in x/y/time, deterministic. */
function perlin3(x: number, y: number, z: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const u = fade(x);
  const v = fade(y);
  const w = fade(z);
  const A = PERM[X]! + Y;
  const AA = PERM[A]! + Z;
  const AB = PERM[A + 1]! + Z;
  const B = PERM[X + 1]! + Y;
  const BA = PERM[B]! + Z;
  const BB = PERM[B + 1]! + Z;
  const x1 = lerp(grad(PERM[AA]!, x, y, z), grad(PERM[BA]!, x - 1, y, z), u);
  const x2 = lerp(grad(PERM[AB]!, x, y - 1, z), grad(PERM[BB]!, x - 1, y - 1, z), u);
  const y1 = lerp(x1, x2, v);
  const x3 = lerp(grad(PERM[AA + 1]!, x, y, z - 1), grad(PERM[BA + 1]!, x - 1, y, z - 1), u);
  const x4 = lerp(grad(PERM[AB + 1]!, x, y - 1, z - 1), grad(PERM[BB + 1]!, x - 1, y - 1, z - 1), u);
  return lerp(y1, lerp(x3, x4, v), w);
}

function fbm3(x: number, y: number, z: number, octaves = 4): number {
  let value = 0;
  let amp = 0.52;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    value += perlin3(x * freq, y * freq, z * freq) * amp;
    norm += amp;
    freq *= 2.03;
    amp *= 0.5;
  }
  return value / (norm || 1);
}

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const m = Math.hypot(x, y, z) || 1;
  return [x / m, y / m, z / m];
}
function dot3(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

// ---------------------------------------------------------------------------
// Field functions (the labs' domain-warped flow + identity fields)
// ---------------------------------------------------------------------------

/**
 * Domain-warped flow field: nested fBm that displaces interior sample
 * coordinates, giving the sphere its fluid internal currents. The fine
 * octave keeps the warp from going static.
 */
function flowFieldAt(x: number, y: number, params: OrbMotionParams, t: number): { x: number; y: number; qx: number; qy: number } {
  const time = t * (0.075 + params.speed * 0.18);
  const qx = fbm3(x * 0.83 + 2.1, y * 0.83 - 1.7, time, 3);
  const qy = fbm3(x * 0.83 - 5.4, y * 0.83 + 3.2, time + 7.8, 3);
  const rx = fbm3(x * 1.38 + qx * 0.82, y * 1.38 + qy * 0.82, time * 1.27 + 11.4, 4);
  const ry = fbm3(x * 1.38 + qx * 0.82 + 8.6, y * 1.38 + qy * 0.82 - 4.9, time * 1.19 - 3.7, 4);
  const fine = fbm3(x * 2.65 + rx * 0.3, y * 2.65 + ry * 0.3, time * 1.61 + 2.2, 3);
  return { x: rx + 0.2 * fine, y: ry - 0.17 * fine, qx, qy };
}

/**
 * The signed domain-warped field that selects each cell's energy anchor.
 * One field creates exactly TWO large evolving regions; the boundary itself
 * drifts fluidly with the noise. The widget turns this selector into the
 * theme's two-color boundary (crisp in composing, drifting in smoke).
 */
function identityFieldAt(x: number, y: number, params: OrbMotionParams, t: number): number {
  // A slightly faster base than the lab so the two-region boundary keeps
  // visibly drifting even in the calm idle presence on a small terminal orb
  // (reports the lab's "no rotation, the field flows" but at a rate that
  // reads as alive rather than frozen at sub-cell resolution).
  const time = t * (0.09 + params.speed * 0.16);
  const qx = fbm3(x * 0.78 + 1.7, y * 0.78 - 3.8, time, 3);
  const qy = fbm3(x * 0.78 - 5.6, y * 0.78 + 2.4, time + 6.3, 3);
  const field =
    0.84 * fbm3(x * 1.12 + qx * 0.78 + 2.7, y * 1.12 + qy * 0.78 - 1.9, time * 1.08 + 4.1, 4) +
    0.2 * fbm3(x * 2.24 - qy * 0.28, y * 2.24 + qx * 0.28, time * 1.43 - 2.3, 3);
  return clamp((field + 1.05) / 2.1, 0, 1);
}

/**
 * The thinking sweep: a broad curved pulse that travels over the spherical
 * surface (constant longitude becomes a curved meridian in projection), with
 * a broad shoulder and a restrained trailing echo — the searching state's
 * "cognition pulse sweeping the sphere".
 */
function thinkingSweep(normal: readonly number[], t: number): { band: number; aura: number; trailing: number } {
  const duration = 1.82;
  const phase = (((t / duration) % 1) + 1) % 1;
  const center = -1.46 + phase * 2.92;
  const longitude = Math.atan2(normal[0]!, Math.max(0.035, normal[2]!));
  const organic = 0.028 * fbm3(normal[1]! * 2.1 + 3.1, t * 0.19, normal[0]! * 0.8 - 2.2, 3);
  const d = longitude + organic - center;
  const band = Math.exp(-((d / 0.235) ** 2));
  const aura = Math.exp(-((d / 0.43) ** 2));
  const trailing = Math.exp(-(((d + 0.34) / 0.27) ** 2)) * 0.24;
  return { band: clamp(band), aura: clamp(aura), trailing: clamp(trailing) };
}

interface OrbPulse {
  born: number;
  amp: number;
  speed: number;
  width: number;
  drift: number;
  seed: number;
}

/** Shell/core/edge contributions of the live pressure pulses at radius r. */
function pulseInfo(pulses: OrbPulse[], t: number, r: number): { shell: number; core: number; edge: number } {
  let shell = 0;
  let core = 0;
  let edge = 0;
  for (const pulse of pulses) {
    const age = t - pulse.born;
    if (age < 0) continue;
    const radius = -0.06 + age * pulse.speed;
    const life = Math.exp(-Math.max(0, age - 1.25) * 2.5);
    const localR = r + pulse.drift * Math.sin(r * 5.4 + pulse.seed + age * 0.7) * (1 - r) * 0.28;
    const band = Math.exp(-(((localR - radius) / pulse.width) ** 2)) * pulse.amp * life;
    shell += band;
    core += pulse.amp * Math.exp(-age * 5.2) * Math.exp((-r * r) / 0.055);
    edge += pulse.amp * Math.exp(-(((radius - 1.0) / 0.145) ** 2)) * life;
  }
  return { shell: clamp(shell), core: clamp(core), edge: clamp(edge) };
}

// ---------------------------------------------------------------------------
// Rasterization
// ---------------------------------------------------------------------------

/** 8×8 Bayer matrix — ordered dithering gives dot density its shading. */
const BAYER8 = [
  [0, 48, 12, 60, 3, 51, 15, 63],
  [32, 16, 44, 28, 35, 19, 47, 31],
  [8, 56, 4, 52, 11, 59, 7, 55],
  [40, 24, 36, 20, 43, 27, 39, 23],
  [2, 50, 14, 62, 1, 49, 13, 61],
  [34, 18, 46, 30, 33, 17, 45, 29],
  [10, 58, 6, 54, 9, 57, 5, 53],
  [42, 26, 38, 22, 41, 25, 37, 21],
];

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

/** Grow-or-fill a reused Float32Array cache (no per-frame allocation). */
function growF32(cache: Float32Array | undefined, n: number): Float32Array {
  if (!cache || cache.length < n) return new Float32Array(n);
  cache.fill(0);
  return cache;
}

/**
 * Braille pack: one terminal cell holds 2×4 subpixels; each subpixel lights
 * its dot when the shaped intensity beats the 8×8 Bayer threshold (density-
 * adjusted), so the shading reads as ordered-dithered dot density. Cells on
 * the halo band sample sparse particles instead of the body. The cell's
 * identity/bloom are averaged over its sampled subpixels; shade comes from
 * the brightest lit subpixel.
 */
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
  c.identity = 0;
}
function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
function clamp(value: number, low = 0, high = 1): number { return Math.max(low, Math.min(high, value)); }
function lerp(a: number, b: number, u: number): number { return a + (b - a) * u; }
