import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
const nodeOk = major > 22 || (major === 22 && minor >= 19);
const provider = (process.env.ORB_PROVIDER ?? process.env.PI_VOICE_PROVIDER ?? "gemini").toLowerCase();
const keyOk = provider === "openai" ? Boolean(process.env.OPENAI_API_KEY) : Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
const exe = process.platform === "win32" ? ".exe" : "";
const key = `${process.platform}-${process.arch}`;
const cacheRoot = process.platform === "win32"
  ? join(process.env.LOCALAPPDATA || homedir(), "Orb", "Cache", "audio")
  : process.platform === "darwin"
    ? join(homedir(), "Library", "Caches", "orb", "audio")
    : join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "orb", "audio");
const candidates = [
  join("bin", key, `orb-audio${exe}`),
  join(cacheRoot, key, `orb-audio${exe}`),
];
let helper = "";
for (const path of candidates) {
  try { await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK); helper = path; break; } catch {}
}
const goCandidates = process.platform === "win32"
  ? [process.env.ORB_GO, "go.exe", join(process.env.ProgramFiles || "C:\\Program Files", "Go", "bin", "go.exe")]
  : [process.env.ORB_GO, "go", "/opt/homebrew/bin/go", "/usr/local/bin/go", "/usr/local/go/bin/go", "/usr/bin/go"];
let go = "";
for (const candidate of goCandidates.filter(Boolean)) {
  const result = spawnSync(candidate, ["version"], { encoding: "utf8" });
  if (result.status === 0) { go = `${candidate} (${String(result.stdout).trim()})`; break; }
}
const platform = process.platform === "win32" ? "windows" : process.platform;
const asset = `orb-audio-${platform}-${process.arch}${exe}`;
console.log(`Orb: ${manifest.version}`);
console.log(`Node: ${process.versions.node} ${nodeOk ? "✓" : "✗ requires >=22.19"}`);
console.log(`Platform: ${process.platform}/${process.arch}`);
console.log(`Provider: ${provider}`);
console.log(`API key: ${keyOk ? "present ✓" : "missing ✗"}`);
console.log(`Audio helper: ${helper ? `${helper} ✓` : "not provisioned"}`);
if (!helper) {
  console.log(`Release asset: ${asset}`);
  console.log(`Provisioning: Orb will try v${manifest.version} and latest GitHub release binaries before any source build.`);
  console.log(`Developer Go fallback: ${go || "not found"}`);
  if (!go) console.log("Normal published installs do not require Go; unreleased source checkouts need a prebuilt helper or Go + a C compiler.");
}
if (!nodeOk || !keyOk) process.exitCode = 1;
