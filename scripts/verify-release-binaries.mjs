import { access } from "node:fs/promises";
import { constants } from "node:fs";

const required = [
  ["linux-x64", "orb-audio"],
  ["darwin-x64", "orb-audio"],
  ["darwin-arm64", "orb-audio"],
  ["win32-x64", "orb-audio.exe"],
];
const missing = [];
for (const [key, name] of required) {
  const path = new URL(`../bin/${key}/${name}`, import.meta.url);
  try { await access(path, key.startsWith("win32") ? constants.F_OK : constants.X_OK); }
  catch { missing.push(`bin/${key}/${name}`); }
}
if (missing.length) throw new Error(`release is missing required prebuilt audio helpers: ${missing.join(", ")}`);
console.log(`verified ${required.length} required release audio helpers`);
