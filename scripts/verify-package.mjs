import { access, readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const required = [
  "dist/extensions/voice.js",
  "src/controller.ts",
  "src/activity.ts",
  "src/pi-control.ts",
  "src/scratchpad.ts",
  "src/delegation.ts",
  "src/audio/bridge.ts",
  "src/audio/helper-resolution.ts",
  "src/audio/input-adapter.ts",
  "audio-helper/cmd/pi-voice-audio/main.go",
  "audio-helper/internal/playback/queue.go",
  "audio-helper/internal/playback/buffer.go",
  "src/providers/gemini.ts",
  "src/providers/openai.ts",
  "src/orb.ts",
  "bin/orb.mjs",
  "scripts/install.sh",
  "scripts/install.ps1",
  "scripts/verify-release-binaries.mjs",
  "config/orb.example.json",
  "prompts/default.md",
  "docs/ARCHITECTURE.md",
  "docs/CONFIGURATION.md",
  "docs/RELEASING.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "docs/assets/orb-terminal.png",
  "docs/assets/orb-banner.png",
  "docs/assets/orb-logo.svg",
  "site/index.html",
  "README.md",
  "LICENSE",
];
for (const path of required) await access(new URL(`../${path}`, import.meta.url));

if (manifest.name !== "@alainux/orb") throw new Error("package name must be @alainux/orb");
if (manifest.version !== "0.6.0") throw new Error("unexpected release version");
if (!manifest.keywords?.includes("pi-package")) throw new Error("missing pi-package keyword");
if (!manifest.pi?.extensions?.includes("./extensions/voice.ts")) throw new Error("Pi extension manifest incorrect");
if (manifest.bin?.orb !== "./bin/orb.mjs") throw new Error("Orb CLI entry point missing");
if (manifest.repository?.url !== "git+https://github.com/alainux/orb.git") throw new Error("repository metadata incorrect");
if (manifest.dependencies?.naudiodon2) throw new Error("legacy Node audio dependency must not be present");

const controller = await readFile(new URL("../src/controller.ts", import.meta.url), "utf8");
for (const banned of ["update_pi_prompt", "submit_pi_prompt", "base_revision", "editorSync", "submitMode"]) {
  if (controller.includes(banned)) throw new Error(`legacy editor-mirroring behavior remains: ${banned}`);
}
console.log(`verified ${manifest.name}@${manifest.version}`);
