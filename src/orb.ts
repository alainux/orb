import type { VoiceSource } from "./types.js";

export type OrbLayer = "none" | "mistA" | "mistB" | "mistC" | "filament";

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

  step(nowMs: number, inputRms: number, outputRms: number, agentSpeaking: boolean, muted = false): OrbFrame {
    if (this.lastMs === 0) this.lastMs = nowMs;
    const dt = clamp((nowMs - this.lastMs) / 1000, 1 / 240, 0.075);
    this.lastMs = nowMs;

    // While muted the mic is dead: the user cannot drive the field, and the
    // constant ambient swirl is frozen too so the orb reads as dormant instead
    // of looking like it is still listening. Agent playback keeps animating.
    const userTarget = muted ? 0 : clamp((inputRms - 0.006) / 0.12, 0, 1);
    let agentTarget = clamp((outputRms - 0.0035) / 0.17, 0, 1);
    if (agentSpeaking && agentTarget < 0.1) agentTarget = 0.1;
    if (!agentSpeaking && agentTarget < 0.018) agentTarget = 0;

    this.userEnergy = envelope(this.userEnergy, userTarget, dt, 0.045, 0.34);
    this.agentEnergy = envelope(this.agentEnergy, agentTarget, dt, 0.04, 0.28);
    const energy = Math.max(this.userEnergy, this.agentEnergy);

    if (energy > this.peak) this.peak = envelope(this.peak, energy, dt, 0.022, 0.72);
    else this.peak *= Math.exp(-dt / 0.78);

    // Calm constant rotation, with speech increasing flow rather than changing orientation abruptly.
    if (!muted) {
      const voiceDrive = 0.55 * this.userEnergy + 0.45 * this.agentEnergy;
      this.phaseA = mod(this.phaseA + dt * (0.23 + 0.18 * voiceDrive), Math.PI * 2);
      this.phaseB = mod(this.phaseB + dt * (0.11 + 0.11 * voiceDrive), Math.PI * 2);
    }

    let source: VoiceSource = "idle";
    if (this.agentEnergy > 0.035 && this.agentEnergy >= this.userEnergy * 0.9) source = "agent";
    else if (this.userEnergy > 0.025) source = "user";

    return { userEnergy: this.userEnergy, agentEnergy: this.agentEnergy, energy, peak: this.peak, phaseA: this.phaseA, phaseB: this.phaseB, source };
  }
}

export class OrbRenderer {
  private cells: OrbCell[] = [];
  constructor(private readonly densityScale = 1.08) {}

  render(width: number, height: number, cellAspect: number, frame: OrbFrame): OrbRaster {
    const raster: OrbRaster = { width, height, centerX: 0, centerY: 0, radiusX: 0, radiusY: 0, cellAspect, cells: [] };
    if (width < 8 || height < 6) return raster;

    cellAspect = clamp(cellAspect, 0.45, 3);
    const maxRadiusY = Math.min((height - 2) / 2, (width - 2) / (2 * cellAspect));
    if (maxRadiusY < 2) return raster;

    const energy = clamp(frame.energy, 0, 1);
    const baseRadiusY = maxRadiusY * 0.79;
    const radiusY = Math.min(maxRadiusY * 0.97, baseRadiusY * (1 + 0.105 * energy));
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

    const edge = Math.min(0.18, 0.56 / radiusY);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nx = (x - raster.centerX) / radiusX;
        const ny = (y - raster.centerY) / radiusY;
        const r2 = nx * nx + ny * ny;
        const radius = Math.sqrt(r2);
        const coverage = 1 - smoothstep(1 - edge, 1 + edge, radius);
        if (coverage <= 0.002 || r2 >= 1.035) continue;

        const zExtent = Math.sqrt(Math.max(0, 1 - Math.min(1, r2)));
        const volume = sampleVolume(nx, ny, zExtent, frame);
        const shell = gaussian((radius - 0.78) / 0.28);
        const baseMist = 0.305 + 0.105 * zExtent + 0.082 * shell;
        const voiceMist = energy * (0.045 + 0.09 * volume.flow);
        const density = clamp(coverage * (baseMist + 0.44 * volume.flow + 0.25 * volume.filament + voiceMist), 0, 0.96);
        const index = y * width + x;
        this.cells[index] = { ...EMPTY_CELL, coverage, density, filament: volume.filament };

        // Stable blue-noise-ish dither: particles stay coherent as the continuous field moves through them.
        const dither = hash01(x, y, 0x5eeda11);
        const occupancy = clamp(density * this.densityScale + 0.045 * volume.frontness, 0, 0.965);
        if (dither > occupancy) continue;

        const local = clamp((occupancy - dither) / Math.max(0.08, occupancy), 0, 1);
        const shade = clamp(0.12 + 0.28 * volume.frontness + 0.34 * volume.flow + 0.22 * volume.filament + 0.08 * frame.peak, 0, 1);
        const glyph = particleGlyph(local, volume.filament, x, y);
        const colorRegion = clamp(
          0.46 * volume.region +
          0.54 * Math.sin(1.72 * nx - 1.18 * ny + frame.phaseA * 0.52) * Math.cos(1.26 * ny + frame.phaseB * 0.41),
          -1,
          1,
        );
        const layer: OrbLayer = volume.filament > 0.54
          ? "filament"
          : colorRegion < -0.16
            ? "mistA"
            : colorRegion > 0.16
              ? "mistB"
              : "mistC";
        this.cells[index] = { coverage, shade, filament: volume.filament, density, glyph, layer };
      }
    }
    return raster;
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

type VolumeSample = { flow: number; filament: number; region: number; frontness: number };

function sampleVolume(nx: number, ny: number, zExtent: number, frame: OrbFrame): VolumeSample {
  const zSteps = [-0.82, -0.38, 0.08, 0.52, 0.88];
  let weightedFlow = 0;
  let weightedFilament = 0;
  let weightedRegion = 0;
  let weightTotal = 0;
  let frontness = 0;

  for (let index = 0; index < zSteps.length; index++) {
    const z = zExtent * zSteps[index]!;
    const p = rotatePoint(nx, ny, z, frame);
    const depthWeight = 0.72 + 0.28 * ((z / Math.max(0.001, zExtent) + 1) * 0.5);
    const turbulence = frame.energy * (
      0.09 * Math.sin(6.1 * p.y + frame.phaseA * 2.3) +
      0.07 * Math.sin(5.4 * p.z - frame.phaseB * 2.1) +
      0.045 * Math.sin(7.3 * (p.x + p.z) + frame.phaseA * 1.4)
    );

    // Broad scalar fields give the smoke body; narrow ridges give wave strands across the sphere.
    const a = Math.sin(2.75 * p.x + 1.55 * p.y + 1.2 * p.z + frame.phaseA * 1.18 + turbulence);
    const b = Math.sin(-1.7 * p.x + 3.05 * p.y - 1.45 * p.z - frame.phaseB * 1.34 - 0.7 * turbulence);
    const c = Math.sin(2.15 * p.x - 1.35 * p.y + 2.6 * p.z + frame.phaseA * 0.63 - frame.phaseB * 0.45);
    const coherent = 0.5 + 0.5 * Math.sin(1.15 * a + 0.9 * b + 0.72 * c);

    const ribbon1 = gaussian((a - 0.22 * b) / (0.27 + 0.035 * frame.energy));
    const ribbon2 = gaussian((b + 0.31 * c) / (0.31 + 0.04 * frame.energy));
    const ribbon3 = gaussian((c - 0.28 * a) / 0.37);

    // A slow helical wave wraps around each rotated volume slice. This is what
    // gives the cloud a coherent spherical current instead of isolated noise.
    const theta = Math.atan2(p.z, p.x);
    const phi = Math.atan2(p.y, Math.hypot(p.x, p.z) + 1e-6);
    const sphericalWave = Math.sin(2.35 * theta + 1.55 * Math.sin(2.1 * phi + frame.phaseB * 0.72) + frame.phaseA * 1.34);
    const surfaceRibbon = gaussian(sphericalWave / (0.24 + 0.035 * frame.energy));

    const filament = clamp(Math.max(ribbon1, 0.88 * ribbon2, 0.68 * ribbon3, 0.9 * surfaceRibbon), 0, 1);
    const flow = clamp(0.28 * coherent + 0.34 * (0.5 + 0.5 * a) + 0.2 * (0.5 + 0.5 * b) + 0.26 * filament, 0, 1);
    const region = clamp(0.52 * Math.sin(1.2 * p.x - 0.92 * p.y + 1.45 * p.z + frame.phaseB * 0.36) + 0.32 * a - 0.24 * b, -1, 1);

    weightedFlow += flow * depthWeight;
    weightedFilament += filament * depthWeight;
    weightedRegion += region * depthWeight;
    weightTotal += depthWeight;
    frontness = Math.max(frontness, z > 0 ? (z / Math.max(0.001, zExtent)) * flow : 0);
  }

  return {
    flow: weightedFlow / weightTotal,
    filament: weightedFilament / weightTotal,
    region: weightedRegion / weightTotal,
    frontness: clamp(frontness, 0, 1),
  };
}

function rotatePoint(x: number, y: number, z: number, frame: OrbFrame): { x: number; y: number; z: number } {
  const yaw = frame.phaseA * 0.72 + 0.11 * Math.sin(frame.phaseB * 0.7);
  const pitch = 0.34 * Math.sin(frame.phaseB * 0.61) + frame.phaseB * 0.16;
  const roll = 0.18 * Math.sin(frame.phaseA * 0.43);

  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);

  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const y2 = y * cp - z1 * sp;
  const z2 = y * sp + z1 * cp;
  return { x: x1 * cr - y2 * sr, y: x1 * sr + y2 * cr, z: z2 };
}

function particleGlyph(local: number, filament: number, x: number, y: number): string {
  // Keep every mark optically small. Dense regions are represented by paired
  // or grouped dots, never by a large filled bullet that breaks the smoke texture.
  if (filament > 0.5 && local > 0.3) return ((x + y) & 1) === 0 ? "⋯" : ":";
  if (local < 0.25) return "·";
  if (local < 0.62) return "∙";
  return ((x * 3 + y) & 3) === 0 ? "⋯" : ":";
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

function gaussian(value: number): number { return Math.exp(-(value * value)); }
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
