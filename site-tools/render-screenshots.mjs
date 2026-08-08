// Render genuine Orb states through the real OrbRenderer (dist/) as crisp
// "terminal" screenshots for the site, captured by headless Chrome at 3x DPI.
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { OrbRenderer, rasterAt } from "../dist/src/orb.js";
import { createOrbPalette, mix } from "../dist/src/theme.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, "../site/assets");
mkdirSync(OUT, { recursive: true });

const theme = {
  fg: () => "",
  getFgAnsi: (name) =>
    name === "accent" ? "\x1b[38;2;121;162;247m"
    : name === "customMessageLabel" ? "\x1b[38;2;187;154;247m"
    : undefined,
  getBgAnsi: () => "\x1b[48;2;26;27;38m",
  getColorMode: () => "truecolor",
};
const palette = createOrbPalette(theme);

const dim = { r: 0x4c, g: 0x54, b: 0x66 };
const muted = { r: 0x78, g: 0x82, b: 0x9a };
const gray = { r: 0x5a, g: 0x62, b: 0x74 };
const WHITE = { r: 255, g: 255, b: 255 };

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function scale(c, f) { return { r: c.r * f, g: c.g * f, b: c.b * f }; }
function desaturate(c) { const l = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b; return { r: l, g: l, b: l }; }
function hexCss(c) {
  c = { r: Math.max(0, Math.min(255, Math.round(c.r))), g: Math.max(0, Math.min(255, Math.round(c.g))), b: Math.max(0, Math.min(255, Math.round(c.b))) };
  return `#${c.r.toString(16).padStart(2, "0")}${c.g.toString(16).padStart(2, "0")}${c.b.toString(16).padStart(2, "0")}`;
}

function cellColorStr(cell, mode, frame, reactivity) {
  const { shade, layer, identity, filament } = cell;
  if (layer === "none") return hexCss(shade > 0.5 ? muted : dim);
  if (frame.muted === true) return hexCss(scale(desaturate(gray), 0.42 + 0.58 * shade));
  const activity = clamp01(frame.energy * reactivity);
  const feather = mode === "composing" ? 0.085 : mode === "searching" ? 0.16 : 0.24;
  const u = clamp01((identity - (0.5 - feather)) / (2 * feather));
  const w = u * u * (3 - 2 * u);
  let color = mix(palette.primary, palette.secondary, w);
  color = scale(color, 0.5 + 0.5 * shade);
  const sheen = mode === "smoke" ? 0.16 : mode === "searching" ? 0.2 : 0.55 + 0.3 * activity;
  color = mix(color, WHITE, clamp01(filament * sheen));
  return hexCss(color);
}

function frameFor(over) {
  return Object.assign({ userEnergy: 0, agentEnergy: 0, energy: 0, source: "idle", t: 12.7, transient: 0, muted: false }, over);
}

const renderer = new OrbRenderer(1.3, 0.7, true);

function orbHtml(state) {
  const raster = renderer.render(state.w, state.h, state.aspect ?? 2, state.frame, state.mode, state.frame.t * 1000);
  let out = "";
  for (let y = 0; y < raster.height; y++) {
    let line = "";
    for (let x = 0; x < raster.width; x++) {
      const cell = rasterAt(raster, x, y);
      line += cell.glyph
        ? `<span style="color:${hexCell(cell, state)}">${cell.glyph}</span>`
        : `<span style="color:${hexCss(dim)}"> </span>`;
    }
    out += line + "\n";
  }
  return out.trimEnd();
}
function hexCell(cell, state) { return cellColorStr(cell, state.mode, state.frame, 0.7); }
function pageHtml(s) {
  const W = s.width ?? 780, H = s.height ?? 720, tw = s.termW ?? 700;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#08090d}
body{width:${W}px;height:${H}px;overflow:hidden;display:flex;align-items:center;justify-content:center;padding:${s.pad ?? 26}px}
.term{width:${tw}px;border-radius:20px;border:1px solid rgba(255,255,255,.09);background:linear-gradient(180deg,#1b1f27,#151921);box-shadow:0 40px 90px rgba(0,0,0,.6);font-family:"SF Mono",Menlo,Consolas,monospace;color:#cdd6e6}
.bar{display:flex;justify-content:space-between;align-items:center;padding:13px 18px;border-bottom:1px solid rgba(255,255,255,.06)}
.dots{display:flex;gap:8px}.dots i{width:12px;height:12px;border-radius:50%;background:#ff5f57}.dots i:nth-child(2){background:#febc2e}.dots i:nth-child(3){background:#28c840}
.dim{color:#6f7a90}
.session{display:flex;justify-content:space-between;padding:12px 18px;font-size:13px;color:#7c869b;border-bottom:1px solid rgba(255,255,255,.05)}
.session b{color:#7aa2f7;font-weight:600}.session .vio{color:#bb9af7;font-weight:600}
.orb{padding:${s.orbPad ?? 16}px ${s.orbPadX ?? 18}px;display:flex;justify-content:center}
.orb pre{font-size:${s.font ?? 20}px;line-height:${s.lh ?? 1.5};letter-spacing:0}
.status{display:flex;justify-content:space-between;padding:12px 18px;border-top:1px solid rgba(255,255,255,.06);font-size:12px;color:#cdd6e6;background:rgba(255,255,255,.015)}
.status .vio{color:#bb9af7;font-weight:600}
</style></head><body>
<div class="term">
  <div class="bar"><div class="dots"><i></i><i></i><i></i></div><div class="t" style="letter-spacing:.04em">pi · orb</div><div class="t">${s.statusRight}</div></div>
  <div class="session"><b>ORB</b> <span class="vio">· ${s.statusV}</span> <span>· Pi ${s.statusPi}</span></div>
  <div class="orb"><pre>${orbHtml(s)}</pre></div>
  <div class="status"><span>${s.footerLeft ?? (s.meters ?? "")}</span><span>${s.footerRight ?? ""}</span></div>
</div>
</body></html>`;
}

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function shoot(s, name) {
  const htmlPath = resolve(__dir, `../dist/shot-${name}.html`);
  const pngPath = resolve(OUT, `orb-state-${name}.png`);
  writeFileSync(htmlPath, pageHtml(s));
  execFileSync(CHROME, [
    "--headless=new", "--hide-scrollbars",
    `--window-size=${(s.width ?? 780)},${(s.height ?? 720)}`,
    "--force-device-scale-factor=3",
    "--default-background-color=08090dff",
    `--screenshot=${pngPath}`, `file://${htmlPath}`,
  ], { stdio: "ignore" });
  console.log("wrote", pngPath);
  return pngPath;
}

// -> wide hero: a big listening orb centred in a generous terminal panel.
shoot({
  width: 1500, height: 820, termW: 1280, pad: 26, font: 22, lh: 1.42,
  orbPad: 20, orbPadX: 30, aspect: 2,
  statusV: "listening", statusPi: "idle · ready",
  statusRight: "voice active",
  footerLeft: "YOU ▮▮▮▮▮▮▮ ░░░  ORB ░░░░░", footerRight: "buffer 0 · live",
  w: 96, h: 16, mode: "composing", frame: frameFor({ userEnergy: 0.45, energy: 0.45, transient: 0.12 }),
}, "hero");

// -> narrow state screenshots for the interactive showcase.
const SERIES = {
  width: 480, height: 300, termW: 430, pad: 22, font: 15, lh: 1.3, orbPad: 8, orbPadX: 10, statusRight: "active",
};
const states = [
  { id: "presence", statusV: "presence", statusPi: "idle", footerLeft: "YOU ········ ORB ········", footerRight: "calm", w: 40, h: 8, mode: "smoke", frame: frameFor({}) },
  { id: "listening", statusV: "listening", statusPi: "idle", footerLeft: "YOU ▮▮▮▮▮▮▮  ORB ░░░", footerRight: "live input", w: 40, h: 8, mode: "composing", frame: frameFor({ userEnergy: 0.5, energy: 0.5, transient: 0.15 }) },
  { id: "thinking", statusV: "thinking", statusPi: "working", footerLeft: "YOU ░░  ORB ▮▮", footerRight: "cognition sweep", w: 40, h: 8, mode: "searching", frame: frameFor({ energy: 0.3, agentEnergy: 0.25 }) },
  { id: "speaking", statusV: "speaking", statusPi: "working", footerLeft: "ORB ▮▮▮▮▮▮", footerRight: "agent speech", w: 40, h: 8, mode: "composing", frame: frameFor({ agentEnergy: 0.8, energy: 0.8, transient: 0.5 }) },
  { id: "muted", statusV: "muted", statusPi: "idle", footerLeft: "YOU · muted · ORB ······", footerRight: "", w: 40, h: 8, mode: "smoke", frame: frameFor({ muted: true }) },
];
for (const s of states) { s.frame = frameFor(s.frame); shoot({ ...SERIES, ...s }, s.id); }