import assert from "node:assert/strict";
import test from "node:test";
import { normalizedRadius, OrbMotion, OrbRenderer, rasterAt, type OrbFrame } from "../src/orb.js";

const frame: OrbFrame = { userEnergy: 0.3, agentEnergy: 0.1, energy: 0.3, peak: 0.5, phaseA: 1.1, phaseB: 2.3, source: "user" };

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
  assert.ok(layers.size >= 3, `theme regions ${[...layers].join(",")}`);
});

test("orb is deterministic and physically circular", () => {
  const a = new OrbRenderer().render(60, 26, 2, frame);
  const snapshot = a.cells.map((cell) => ({ ...cell }));
  const b = new OrbRenderer().render(60, 26, 2, frame);
  assert.deepEqual(snapshot, b.cells);
  assert.ok(Math.abs(b.radiusX / (b.radiusY * b.cellAspect) - 1) < 1e-12);
});

test("rotation changes the smoke field without changing the circular mask", () => {
  const a = new OrbRenderer().render(52, 24, 2, frame);
  const b = new OrbRenderer().render(52, 24, 2, { ...frame, phaseA: 4.8, phaseB: 5.9 });
  let changed = 0;
  for (let index = 0; index < a.cells.length; index++) {
    assert.ok(Math.abs((a.cells[index]?.coverage ?? 0) - (b.cells[index]?.coverage ?? 0)) < 1e-12);
    if (a.cells[index]?.glyph !== b.cells[index]?.glyph || a.cells[index]?.layer !== b.cells[index]?.layer) changed++;
  }
  assert.ok(changed > 35);
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
