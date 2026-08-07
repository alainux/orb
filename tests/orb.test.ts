import assert from "node:assert/strict";
import test from "node:test";
import { normalizedRadius, OrbMotion, OrbRenderer, rasterAt, type OrbFrame, type OrbMode } from "../src/orb.js";

const frame: OrbFrame = { userEnergy: 0.3, agentEnergy: 0.1, energy: 0.3, source: "user" };

test("smoke orb is full but granular and never uses oversized filled-circle glyphs", () => {
  const raster = new OrbRenderer().render(56, 26, 2, frame);
  const allowed = new Set(["·", "∙", ":", "⋯"]);
  let inside = 0;
  let occupied = 0;
  let filaments = 0;
  const layers = new Set<string>();
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      if (normalizedRadius(raster, x, y) > 0.88) continue;
      inside++;
      const cell = rasterAt(raster, x, y);
      if (!cell.glyph) continue;
      occupied++;
      layers.add(cell.layer);
      assert.equal(allowed.has(cell.glyph), true, `unexpected glyph ${cell.glyph}`);
      assert.notEqual(cell.glyph, "●");
      assert.notEqual(cell.glyph, "•");
      if (cell.layer === "filament") filaments++;
    }
  }
  const occupancy = occupied / inside;
  assert.ok(occupancy > 0.58 && occupancy < 0.96, `occupancy ${occupancy}`);
  assert.ok(filaments > 16, `filaments ${filaments}`);
  // Inside the disk the solid sphere shows the two core theme bands — bright
  // front filament and mid mist; the cooler mist bands sit near the limb
  // (outside r<0.88) where the depth shading dims them out.
  assert.ok(layers.size >= 2, `theme regions ${[...layers].join(",")}`);
});

test("orb is deterministic and physically circular", () => {
  const a = new OrbRenderer().render(60, 26, 2, frame);
  const snapshot = a.cells.map((cell) => ({ ...cell }));
  const b = new OrbRenderer().render(60, 26, 2, frame);
  assert.deepEqual(snapshot, b.cells);
  assert.ok(Math.abs(b.radiusX / (b.radiusY * b.cellAspect) - 1) < 1e-12);
});

test("the surface field travels with the clock, not rigid-body rotation", () => {
  // The negative-space renderer never rotates the sphere as a rigid body: at
  // terminal resolution, rotating point clouds alias into incoherent shimmer.
  // The sphere stays fixed and its carved features travel with the animation
  // clock: half a second later the listening grooves have moved across the
  // surface.
  const t1 = new OrbRenderer().render(52, 24, 2, frameAt(5));
  const t2 = new OrbRenderer().render(52, 24, 2, frameAt(5.5));
  let changed = 0;
  for (let index = 0; index < t1.cells.length; index++) {
    if (t1.cells[index]?.glyph !== t2.cells[index]?.glyph) changed++;
  }
  assert.ok(changed > 10, `clock travel changed ${changed} cells`);
});

test("motion attacks and releases smoothly", () => {
  const motion = new OrbMotion();
  let now = 1_000;
  let prior = motion.step(now, 0, 0, false).energy;
  for (let index = 0; index < 8; index++) {
    now += 16;
    const next = motion.step(now, 0.13, 0, false).energy;
    assert.ok(next >= prior);
    assert.ok(next < 1);
    prior = next;
  }
  const peak = prior;
  for (let index = 0; index < 8; index++) {
    now += 16;
    const next = motion.step(now, 0, 0, false).energy;
    assert.ok(next <= prior + 1e-12);
    prior = next;
  }
  assert.ok(prior > 0 && prior < peak);
});

test("muted motion kills the mic drive but the clock keeps traveling", () => {
  const motion = new OrbMotion();
  let now = 1_000;
  // Live input builds user energy.
  for (let index = 0; index < 12; index++) { now += 16; motion.step(now, 0.13, 0, false); }
  const live = motion.step(now, 0.13, 0, false);
  assert.ok(live.userEnergy > 0.9, `user energy before mute ${live.userEnergy}`);
  const mutedA = motion.step(now + 16, 0.13, 0, false, true);
  assert.ok(mutedA.userEnergy < live.userEnergy, "user energy starts decaying on mute");
  const mutedAT = mutedA.t ?? 0;
  // Even with loud input, while muted the field must come to rest.
  for (let index = 0; index < 200; index++) { now += 16; motion.step(now, 0.13, 0, false, true); }
  const mutedB = motion.step(now, 0.13, 0, false, true);
  assert.ok(mutedB.userEnergy < 0.001, `user energy after decay ${mutedB.userEnergy}`);
  assert.equal(mutedB.source, "idle", "muted source must not read as user");
  assert.ok((mutedB.t ?? 0) > mutedAT, "the animation clock keeps advancing while muted");
  // Unmuting rebuilds the user response.
  const resumed = motion.step(now + 16, 0.13, 0, false);
  assert.ok(resumed.userEnergy > mutedB.userEnergy, "user energy rebuilds after unmute");
});

function populatedCells(raster: { cells: { glyph: string }[] }): number {
  return raster.cells.reduce((count, cell) => count + (cell.glyph ? 1 : 0), 0);
}
function frameAt(t: number, userEnergy = 0, agentEnergy = 0): OrbFrame {
  return { userEnergy, agentEnergy, energy: Math.max(userEnergy, agentEnergy), source: userEnergy > 0 ? "user" : "idle", t };
}

test("every mode renders the same traveling wave base", () => {
  const renderer = new OrbRenderer();
  // Snapshot cells before the next render: the renderer reuses its cell buffer.
  const frames = new Map<OrbMode, { glyph: string; layer: string; shade: number }[]>();
  for (const mode of ["smoke", "composing", "searching"] as OrbMode[]) {
    frames.set(mode, snapshotCells(renderer.render(56, 26, 2, frameAt(5, 0.4), mode)));
  }
  // Listening's wavy pattern is the base carve for every mode; the modes only
  // differ in color identity (applied in widget.ts), so the geometry matches.
  const smoke = frames.get("smoke")!;
  for (const mode of ["composing", "searching"] as OrbMode[]) {
    assert.deepEqual(frames.get(mode), smoke, `${mode} must share the listening wave geometry`);
  }
  // Deterministic: the same frame always produces the same cells.
  assert.deepEqual(smoke, snapshotCells(renderer.render(56, 26, 2, frameAt(5, 0.4), "smoke")));
  // Negative space: the sphere stays mostly solid (the wave grooves are carved
  // OUT of it), with bright filament bands where the depth shading is strongest
  // and the cooler mist bands around the limb.
  const populated = smoke.filter((c) => c.glyph).length;
  assert.ok(populated > 300, `wave sphere populated ${populated}`);
  assert.ok(smoke.some((c) => c.layer === "filament"), "the sphere has bright filament bands");
  assert.ok(smoke.some((c) => c.layer === "mistC" || c.layer === "mistB"), "limb cells keep the cooler mist bands");
});

test("mic input widens the wave grooves and adds disturbance", () => {
  const renderer = new OrbRenderer();
  const calmCells = renderer.render(56, 26, 2, frameAt(6, 0.02), "composing").cells.map((c) => ({ ...c }));
  const loud = renderer.render(56, 26, 2, frameAt(6, 0.85), "composing");
  // Same t, same geometry — only the mic energy differs, so the carve must
  // visibly change (not just brightness): louder input carves wider grooves
  // out of the solid sphere, so fewer cells stay populated.
  let changed = 0;
  for (let index = 0; index < calmCells.length; index++) {
    const c = calmCells[index]!;
    const l = loud.cells[index]!;
    if (c.glyph !== l.glyph || c.layer !== l.layer || Math.abs(c.shade - l.shade) > 0.05) changed++;
  }
  assert.ok(changed > 30, `loud mic changed ${changed} cells`);
  assert.ok(
    loud.cells.filter((c) => c.glyph).length < calmCells.filter((c) => c.glyph).length,
    "a louder mic carves wider grooves, so fewer cells stay populated",
  );
});

test("searching keeps the base wave traveling over time", () => {
  const renderer = new OrbRenderer();
  // The shared wave pattern: the carved grooves travel by clock phase.
  const t0Cells = renderer.render(56, 26, 2, frameAt(1.96), "searching").cells.map((c) => ({ ...c }));
  const t1 = renderer.render(56, 26, 2, frameAt(2.2), "searching");
  assert.ok(t0Cells.filter((c) => c.glyph).length > 150, `wave sphere populated ${t0Cells.filter((c) => c.glyph).length}`);
  let changed = 0;
  for (let index = 0; index < t0Cells.length; index++) {
    if (t0Cells[index]?.glyph !== t1.cells[index]?.glyph) changed++;
  }
  assert.ok(changed > 10, `wave moved ${changed} cells`);
  assert.ok(t0Cells.some((c) => c.shade > 0.8), "wave fronts contain bright cells");
});

test("size variants adapt the surface density", () => {
  const renderer = new OrbRenderer();
  const small = renderer.render(18, 9, 2, frameAt(3, 0.4), "composing");
  const big = renderer.render(52, 26, 2, frameAt(3, 0.4), "composing");
  assert.ok(populatedCells(small) < populatedCells(big), `small ${populatedCells(small)} vs big ${populatedCells(big)}`);
  const smallScan = renderer.render(18, 9, 2, frameAt(3), "searching");
  const bigScan = renderer.render(52, 26, 2, frameAt(3), "searching");
  assert.ok(populatedCells(smallScan) < populatedCells(bigScan), "ring-wave sphere density follows size");
});

test("the base wave clock keeps traveling even while muted", () => {
  const motion = new OrbMotion();
  let now = 1_000;
  const a = motion.step(now, 0.1, 0, false);
  const b = motion.step(now + 16, 0.1, 0, false);
  assert.ok((b.t ?? 0) > (a.t ?? 0), "clock advances while live");
  const muted = motion.step(now + 32, 0.1, 0, false, true);
  const stillMuted = motion.step(now + 48, 0.1, 0, false, true);
  assert.ok((muted.t ?? 0) > (b.t ?? 0), "clock keeps advancing on mute");
  assert.ok((stillMuted.t ?? 0) > (muted.t ?? 0), "the base wave must keep traveling while muted");
  const resumed = motion.step(now + 64, 0.1, 0, false);
  assert.ok((resumed.t ?? 0) > (stillMuted.t ?? 0), "clock keeps advancing after unmute");
});

function snapshotCells(raster: { cells: { glyph: string; layer: string; shade: number }[] }): { glyph: string; layer: string; shade: number }[] {
  return raster.cells.map((c) => ({ glyph: c.glyph, layer: c.layer, shade: c.shade }));
}
function audioFrame(t: number, userEnergy: number, agentEnergy = 0, transient = 0, muted = false): OrbFrame {
  return { userEnergy, agentEnergy, energy: Math.max(userEnergy, agentEnergy), source: userEnergy > 0 ? "user" : "idle", t, transient, muted };
}
function diffCount(a: { glyph: string }[], b: { glyph: string }[]): number {
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (a[i]?.glyph !== b[i]?.glyph) changed++;
  return changed;
}

test("attack transients sharpen the composing disturbance", () => {
  const renderer = new OrbRenderer();
  const calm = snapshotCells(renderer.render(56, 26, 2, audioFrame(5, 0.5, 0, 0), "composing"));
  const sharp = renderer.render(56, 26, 2, audioFrame(5, 0.5, 0, 1), "composing");
  assert.ok(diffCount(calm, snapshotCells(sharp)) > 0, "a transient must visibly disturb the wave grooves");
  // Deterministic: the same transient and frame always produce the same cells.
  const again = renderer.render(56, 26, 2, audioFrame(5, 0.5, 0, 1), "composing");
  assert.deepEqual(snapshotCells(sharp), snapshotCells(again));
});

test("the reactivity knob scales the audio response", () => {
  const flat = new OrbRenderer(1.08, 0);
  const hot = new OrbRenderer(1.08, 1);
  const frame = audioFrame(5, 0.9);
  // Composing at high energy: reactivity scales the audio term that widens the
  // carved grooves, so 0 vs 1 must carve visibly different wave patterns.
  const dormant = snapshotCells(flat.render(56, 26, 2, frame, "composing"));
  const reactive = hot.render(56, 26, 2, frame, "composing");
  assert.ok(diffCount(dormant, snapshotCells(reactive)) > 60, "full reactivity must widen the carved grooves far beyond zero reactivity");
  const dormantBraille = snapshotCells(new OrbRenderer(1.08, 0, true).render(56, 26, 2, frame, "composing"));
  const reactiveBraille = new OrbRenderer(1.08, 1, true).render(56, 26, 2, frame, "composing");
  assert.ok(diffCount(dormantBraille, snapshotCells(reactiveBraille)) > 60, "braille reactivity must scale too");
});

test("muted frames drop audio disturbance but keep the base wave", () => {
  const renderer = new OrbRenderer();
  for (const mode of ["smoke", "composing", "searching"] as OrbMode[]) {
    // Muting kills the audio-driven disturbance even with huge energy +
    // transient: muted frames with loud audio render identically to muted
    // frames in silence.
    const mutedLoud = snapshotCells(renderer.render(56, 26, 2, audioFrame(4, 0.9, 0.9, 1, true), mode));
    const mutedQuiet = renderer.render(56, 26, 2, audioFrame(4, 0, 0, 0, true), mode);
    assert.deepEqual(snapshotCells(mutedQuiet), mutedLoud, `${mode} must not react to audio while muted`);
    // The base wave still travels while muted (the clock keeps advancing).
    const mutedLater = renderer.render(56, 26, 2, audioFrame(5, 0, 0, 0, true), mode);
    assert.notDeepEqual(snapshotCells(mutedLater), mutedLoud, `${mode} base wave must keep traveling while muted`);
    // A silent non-muted room breathes slightly larger (ambient radius), so it
    // differs from the compact muted wave — and it stays alive without audio.
    const silent = snapshotCells(renderer.render(56, 26, 2, audioFrame(4, 0, 0, 0, false), mode));
    assert.notDeepEqual(silent, mutedLoud, `${mode} silent room stays ambient`);
  }
});

test("motion spikes an attack transient that decays quickly", () => {
  const motion = new OrbMotion();
  let now = 1_000;
  motion.step(now, 0, 0, false); // quiet baseline
  const onset = motion.step(now + 16, 0.9, 0, false);
  assert.ok((onset.transient ?? 0) > 0.5, `onset transient ${onset.transient}`);
  for (let i = 0; i < 30; i++) { now += 16; motion.step(now, 0.9, 0, false); }
  const settled = motion.step(now, 0.9, 0, false);
  assert.ok((settled.transient ?? 0) < 0.1, `settled transient ${settled.transient}`);
  for (let i = 0; i < 30; i++) { now += 16; motion.step(now, 0, 0, false); }
  const quiet = motion.step(now, 0, 0, false);
  assert.ok((quiet.transient ?? 0) < 0.02, `quiet transient ${quiet.transient}`);
});

// ---------------------------------------------------------------------------
// Braille mode: each terminal cell packs 2×4 subpixels into a U+2800+mask
// glyph, giving up to 8 dots per cell — a much denser, finer-grained orb.
// ---------------------------------------------------------------------------

function brailleDots(glyph: string): number {
  const cp = glyph.codePointAt(0) ?? 0;
  let mask = cp - 0x2800;
  let dots = 0;
  while (mask > 0) { dots += mask & 1; mask >>= 1; }
  return dots;
}

test("braille mode packs every mode into U+2800..U+28FF glyphs", () => {
  const renderer = new OrbRenderer(1.08, 0.7, true);
  for (const mode of ["smoke", "composing", "searching"] as OrbMode[]) {
    const raster = renderer.render(56, 26, 2, frameAt(3, mode === "composing" ? 0.5 : 0), mode);
    let populated = 0;
    let totalDots = 0;
    const masks = new Set<number>();
    for (const cell of raster.cells) {
      if (!cell.glyph) continue;
      const cp = cell.glyph.codePointAt(0) ?? 0;
      assert.ok(cp >= 0x2800 && cp <= 0x28ff, `${mode} produced non-Braille glyph U+${cp.toString(16)}`);
      populated++;
      masks.add(cp - 0x2800);
      totalDots += brailleDots(cell.glyph);
    }
    assert.ok(populated > 100, `${mode} braille populated ${populated}`);
    assert.ok(masks.size > 20, `${mode} braille masks lack variety (${masks.size})`);
    // The full sphere packs several dots per cell; even the ring-wave mode
    // with its carved fronts averages well over one dot per populated cell.
    const minDotsPerCell = mode === "searching" ? 1.2 : 2;
    assert.ok(totalDots > populated * minDotsPerCell, `${mode}: ${totalDots} dots / ${populated} cells`);
  }
});

test("braille mode is denser than the glyph mode for the same frame", () => {
  const cellRenderer = new OrbRenderer();
  const brailleRenderer = new OrbRenderer(1.08, 0.7, true);
  for (const mode of ["smoke", "composing", "searching"] as OrbMode[]) {
    const frame = frameAt(3, mode === "composing" ? 0.5 : 0);
    const cells = cellRenderer.render(56, 26, 2, frame, mode);
    const braille = brailleRenderer.render(56, 26, 2, frame, mode);
    const glyphPop = cells.cells.filter((c) => c.glyph).length;
    const brailleDotsTotal = braille.cells.reduce((sum, c) => sum + (c.glyph ? brailleDots(c.glyph) : 0), 0);
    // Braille packs up to 8 dots per cell, so the visible mark count must
    // exceed the single-glyph-per-cell count of the glyph mode. Braille also
    // populates more cells: its 2×4 subpixels catch the sphere's rim where the
    // glyph mode's per-cell center sampling misses partial-coverage cells.
    const minRatio = mode === "searching" ? 1.1 : 2;
    assert.ok(brailleDotsTotal > glyphPop * minRatio, `${mode}: braille dots ${brailleDotsTotal} vs glyph cells ${glyphPop}`);
    if (mode === "smoke") {
      // The sparse glyph smoke spreads into far more populated Braille cells.
      const braillePop = braille.cells.filter((c) => c.glyph).length;
      assert.ok(braillePop > glyphPop, `smoke: braille ${braillePop} vs glyph ${glyphPop}`);
    }
  }
});

test("braille mode keeps audio reactivity and the always-traveling base wave", () => {
  const renderer = new OrbRenderer(1.08, 0.7, true);
  // Same t, louder mic → the carved grooves widen (negative space) and shade.
  const quietCells = renderer.render(56, 26, 2, audioFrame(4, 0.05), "composing").cells.map((c) => ({ ...c }));
  const loud = renderer.render(56, 26, 2, audioFrame(4, 0.85), "composing");
  let changed = 0;
  for (let i = 0; i < quietCells.length; i++) {
    if (quietCells[i]?.glyph !== loud.cells[i]?.glyph || quietCells[i]?.shade !== loud.cells[i]?.shade) changed++;
  }
  assert.ok(changed > 20, `braille composing reacts to the mic (${changed} cells)`);
  // Muting drops the audio disturbance but keeps the wave; muted matches
  // across any audio input, and every mode stays alive in silence.
  for (const mode of ["smoke", "composing", "searching"] as OrbMode[]) {
    const silent = snapshotCells(renderer.render(56, 26, 2, audioFrame(4, 0, 0, 0, false), mode));
    const muted = snapshotCells(renderer.render(56, 26, 2, audioFrame(4, 0.9, 0.9, 1, true), mode));
    assert.notDeepEqual(silent, muted, `braille ${mode} stays ambient in silence`);
  }
  const mutedLoud = snapshotCells(renderer.render(56, 26, 2, audioFrame(4, 0.9, 0.9, 1, true), "composing"));
  const mutedQuiet = snapshotCells(renderer.render(56, 26, 2, audioFrame(4, 0, 0, 0, true), "composing"));
  assert.deepEqual(mutedQuiet, mutedLoud, "muted braille must not react to audio");
  // Deterministic: same inputs → same cells.
  const again = renderer.render(56, 26, 2, audioFrame(4, 0.85), "composing");
  assert.deepEqual(loud.cells.map((c) => ({ ...c })), again.cells.map((c) => ({ ...c })));
});

test("braille smoke renders within a small constant of the glyph smoke", () => {
  // Regression guard: the idle braille orb used to sample the smoke volume at
  // every subpixel (~6× slower than glyph smoke), stalling the event loop that
  // delivers audio to the sidecar. The volume is sampled once per cell now.
  // Ratio-based so the bound holds regardless of machine speed.
  const frame = audioFrame(4, 0.6);
  const glyph = new OrbRenderer(1.3, 0.7, false);
  const braille = new OrbRenderer(1.3, 0.7, true);
  const width = 100, height = 40;
  const measure = (renderer: OrbRenderer, iters: number) => {
    renderer.render(width, height, 2, frame, "smoke"); // warmup
    const t0 = performance.now();
    for (let i = 0; i < iters; i++) renderer.render(width, height, 2, frame, "smoke");
    return (performance.now() - t0) / iters;
  };
  const glyphMs = measure(glyph, 30);
  const brailleMs = measure(braille, 30);
  // The surface renderer is ~4–5× the glyph cost but ~2ms absolute at 100×40,
  // well inside the 20Hz frame budget. The guard is an absolute-plus-ratio
  // bound so it still catches the old per-subpixel-sampling regression
  // (~15ms, ~6×) while tolerating machine-speed variation.
  assert.ok(brailleMs < Math.max(8, glyphMs * 5), `braille smoke ${brailleMs.toFixed(2)}ms vs glyph ${glyphMs.toFixed(2)}ms — surface renderer regressed`);
});

// ---------------------------------------------------------------------------
// Unified listening state + smooth mode transitions
// ---------------------------------------------------------------------------

test("the base wave stays alive and traveling whether muted or silent", () => {
  const renderer = new OrbRenderer(1.3, 0.7, false);
  const silent: OrbFrame = { userEnergy: 0, agentEnergy: 0, energy: 0, source: "idle", t: 5, muted: false };
  const quiet = snapshotCells(renderer.render(56, 26, 2, silent, "smoke"));
  // Silent: the wave keeps traveling even with no sound at all.
  const later = snapshotCells(renderer.render(56, 26, 2, { ...silent, t: 6 }, "smoke"));
  assert.notDeepEqual(later, quiet, "silent listening must keep animating (waves travel)");
  // Muted: the same minimal base wave, and it keeps traveling too. Muted
  // renders a slightly smaller sphere (no ambient radius) and gray color in
  // the widget, so it still differs from the silent room.
  const muted = snapshotCells(renderer.render(56, 26, 2, { ...silent, muted: true }, "smoke"));
  assert.notDeepEqual(muted, quiet, "muted keeps the compact minimal sphere");
  const mutedLater = snapshotCells(renderer.render(56, 26, 2, { ...silent, muted: true, t: 6 }, "smoke"));
  assert.notDeepEqual(mutedLater, muted, "the muted base wave must keep traveling");
  // Braille gets the same treatment.
  const braille = new OrbRenderer(1.3, 0.7, true);
  const bQuiet = snapshotCells(braille.render(56, 26, 2, silent, "smoke"));
  const bMuted = snapshotCells(braille.render(56, 26, 2, { ...silent, muted: true }, "smoke"));
  assert.notDeepEqual(bQuiet, bMuted, "braille listening stays alive without audio");
});

test("mode switches dissolve smoothly and deterministically", () => {
  const frame = audioFrame(4, 0.5);
  const r = new OrbRenderer(1.3, 0.7, false);
  // The first render snaps to the requested mode (no fade from nothing).
  const first = snapshotCells(r.render(56, 26, 2, frame, "smoke", 1000));
  const pureSmoke = snapshotCells(new OrbRenderer(1.3, 0.7, false).render(56, 26, 2, frame, "smoke", 1000));
  assert.deepEqual(first, pureSmoke);
  // Mid-fade: a mix of both modes — it must differ from both pure endpoints.
  const mid = snapshotCells(r.render(56, 26, 2, frame, "searching", 1000 + 240));
  const pureSearch = snapshotCells(new OrbRenderer(1.3, 0.7, false).render(56, 26, 2, frame, "searching", 1000));
  assert.notDeepEqual(mid, pureSmoke, "mid-fade must retain some smoke cells");
  assert.notDeepEqual(mid, pureSearch, "mid-fade must not yet be the full searching globe");
  assert.ok(r.fading, "renderer must report the in-progress dissolve");
  // After the fade window the new mode renders pure.
  assert.deepEqual(snapshotCells(r.render(56, 26, 2, frame, "searching", 1000 + 900)), pureSearch);
  assert.equal(r.fading, false, "the dissolve must end");
  // Deterministic: replaying the same clock produces identical mid-fade cells.
  const r2 = new OrbRenderer(1.3, 0.7, false);
  r2.render(56, 26, 2, frame, "smoke", 1000);
  assert.deepEqual(snapshotCells(r2.render(56, 26, 2, frame, "searching", 1240)), mid);
  // Without a clock (one-shot renders) the transition snaps.
  const snap = new OrbRenderer(1.3, 0.7, false);
  snap.render(56, 26, 2, frame, "smoke");
  assert.deepEqual(snapshotCells(snap.render(56, 26, 2, frame, "searching")), pureSearch);
});
