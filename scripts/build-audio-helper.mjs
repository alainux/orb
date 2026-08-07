import { access, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import process from "node:process";

const soft = process.argv.includes("--soft");
const ifNeeded = process.argv.includes("--if-needed");
const exe = process.platform === "win32" ? ".exe" : "";
const key = `${process.platform}-${process.arch}`;
const target = join("bin", key, `orb-audio${exe}`);
const legacyTarget = join("bin", key, `pi-voice-audio${exe}`);
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

async function exists(path) {
  try { await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK); return true; }
  catch { return false; }
}

if (ifNeeded && (await exists(target) || await exists(legacyTarget))) {
  console.log(`audio helper present for ${key}`);
  process.exit(0);
}
await mkdir(dirname(target), { recursive: true });

// Install-time provisioning should never assume Go is installed. Published
// releases provide binaries; source compilation is only performed by the
// explicit `npm run build:audio` developer command.
if (ifNeeded) {
  if (await downloadRelease(target)) {
    console.log(`downloaded prebuilt Orb audio helper: ${target}`);
    process.exit(0);
  }
  const message = [
    `Orb audio helper for ${key} was not bundled and no published release binary could be downloaded.`,
    `This is expected only for unreleased source checkouts; normal Orb releases do not require Go.`,
    `Developers can run: npm run build:audio`,
  ].join(" ");
  if (soft) { console.warn(message); process.exit(0); }
  console.error(message);
  process.exit(1);
}

const go = await findGo();
if (!go) {
  console.error(`Go was not found. Building Orb from source requires Go 1.23+ and a C compiler. Normal published installs use a prebuilt audio helper.`);
  process.exit(127);
}
const buildEnv = { ...process.env, CGO_ENABLED: "1" };
// -mod=mod lets Go fetch and record the exact module dependencies declared in
// audio-helper/go.mod. Contributors should never need a separate `go get`.
const child = spawn(go, ["build", "-mod=mod", "-trimpath", "-o", join("..", target), "./cmd/pi-voice-audio"], {
  cwd: "audio-helper",
  stdio: "inherit",
  env: buildEnv,
});
const code = await new Promise((resolve) => child.on("exit", (value) => resolve(value ?? 1)).on("error", () => resolve(127)));
if (code !== 0) {
  console.error(`could not build Orb audio helper for ${key} using ${go}. Ensure a C compiler and platform audio development libraries are installed.`);
  process.exit(code);
}
if (process.platform !== "win32") await chmod(target, 0o755);
console.log(`built ${target}`);
console.log("Go module dependencies are resolved automatically; no manual go get step is required.");

async function findGo() {
  const candidates = [];
  if (process.env.ORB_GO?.trim()) candidates.push(process.env.ORB_GO.trim());
  if (process.platform === "win32") {
    candidates.push("go.exe", join(process.env.ProgramFiles || "C:\\Program Files", "Go", "bin", "go.exe"), "C:\\Go\\bin\\go.exe");
    if (process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, "Programs", "Go", "bin", "go.exe"));
  } else {
    candidates.push("go", "/opt/homebrew/bin/go", "/usr/local/bin/go", "/usr/local/go/bin/go", "/usr/bin/go", "/snap/bin/go");
  }
  for (const candidate of [...new Set(candidates)]) {
    const result = spawn(candidate, ["version"], { stdio: "ignore" });
    const ok = await new Promise((resolve) => result.on("exit", (code) => resolve(code === 0)).on("error", () => resolve(false)));
    if (ok) return candidate;
  }
  return undefined;
}

async function downloadRelease(destination) {
  const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : process.platform;
  const asset = `orb-audio-${platform}-${process.arch}${exe}`;
  const version = (process.env.ORB_AUDIO_RELEASE_VERSION || manifest.version).replace(/^v/, "");
  const customBase = process.env.ORB_AUDIO_RELEASE_BASE_URL?.replace(/\/$/, "");
  const urls = customBase
    ? [`${customBase}/${asset}`]
    : [
        `https://github.com/alainux/orb/releases/download/v${version}/${asset}`,
        `https://github.com/alainux/orb/releases/latest/download/${asset}`,
      ];
  for (const url of urls) {
    try {
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) continue;
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length < 16 * 1024) continue;
      const temp = `${destination}.download-${process.pid}`;
      await writeFile(temp, data);
      if (process.platform !== "win32") await chmod(temp, 0o755);
      await rename(temp, destination);
      return true;
    } catch {
      try { await rm(`${destination}.download-${process.pid}`, { force: true }); } catch {}
    }
  }
  return false;
}
