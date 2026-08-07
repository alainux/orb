import { access, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import type { RunLog } from "../log.js";

export interface HelperResolution {
  path: string;
  source: "override" | "bundled" | "cache" | "download" | "source-build";
}

export function platformKey(platform = process.platform, arch = process.arch): string {
  return `${platform}-${arch}`;
}

export function releaseAssetName(platform = process.platform, arch = process.arch): string {
  const normalized = platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : platform;
  return `orb-audio-${normalized}-${arch}${platform === "win32" ? ".exe" : ""}`;
}

export function commonGoCandidates(platform = process.platform, env: Record<string, string | undefined> = process.env): string[] {
  const explicit = env.ORB_GO?.trim();
  const candidates: string[] = explicit ? [explicit] : [];
  if (platform === "win32") {
    const pf = env.ProgramFiles ?? "C:\\Program Files";
    const local = env.LOCALAPPDATA;
    candidates.push("go.exe", join(pf, "Go", "bin", "go.exe"), "C:\\Go\\bin\\go.exe");
    if (local) candidates.push(join(local, "Programs", "Go", "bin", "go.exe"));
  } else {
    candidates.push("go", "/opt/homebrew/bin/go", "/usr/local/bin/go", "/usr/local/go/bin/go", "/usr/bin/go", "/snap/bin/go");
  }
  return [...new Set(candidates)];
}

export async function resolveAudioHelper(log: RunLog): Promise<HelperResolution> {
  const override = (process.env.ORB_AUDIO_HELPER ?? process.env.PI_VOICE_AUDIO_HELPER)?.trim();
  if (override) {
    await ensureExecutable(override);
    return { path: override, source: "override" };
  }

  const root = await locateProjectRoot();
  const exe = process.platform === "win32" ? ".exe" : "";
  const key = platformKey();
  const bundled = join(root, "bin", key, `orb-audio${exe}`);
  const legacyBundled = join(root, "bin", key, `pi-voice-audio${exe}`);
  for (const candidate of [bundled, legacyBundled]) {
    if (await existsExecutable(candidate)) return { path: candidate, source: "bundled" };
  }

  const cached = join(audioCacheRoot(), key, `orb-audio${exe}`);
  if (await existsExecutable(cached)) return { path: cached, source: "cache" };
  await mkdir(dirname(cached), { recursive: true });

  const downloaded = await downloadReleaseBinary(root, cached, log);
  if (downloaded) return { path: cached, source: "download" };

  // Source builds are a developer/pre-release fallback only. Normal published
  // installs are expected to resolve a bundled or release binary above.
  const go = await findGoExecutable();
  if (go) {
    const helperSource = join(root, "audio-helper");
    await log.info("prebuilt audio helper unavailable; building source fallback", { helperSource, cached, go });
    try {
      const buildEnv = { ...process.env, CGO_ENABLED: "1" };
      await execFileAsync(go, ["mod", "download"], { cwd: helperSource, env: buildEnv });
      await execFileAsync(go, ["build", "-trimpath", "-o", cached, "./cmd/pi-voice-audio"], {
        cwd: helperSource,
        env: buildEnv,
      });
      if (process.platform !== "win32") await chmod(cached, 0o755);
      await ensureExecutable(cached);
      return { path: cached, source: "source-build" };
    } catch (error) {
      throw new Error(
        `Orb could not provision its audio helper for ${key}. A prebuilt release binary was unavailable, and the local source build failed using ${go}: ${asError(error).message}`,
      );
    }
  }

  const asset = releaseAssetName();
  throw new Error(
    [
      `Orb audio helper is unavailable for ${key}.`,
      `Expected the published release asset ${asset}, but it could not be downloaded and no local Go toolchain was found.`,
      "Normal Orb releases do not require Go.",
      "If you are testing an unreleased source checkout, either install Go and run `npm run build:audio`, or point ORB_AUDIO_HELPER at a prebuilt helper binary.",
    ].join(" "),
  );
}

export async function locateProjectRoot(fromFile = fileURLToPath(import.meta.url)): Promise<string> {
  let current = dirname(fromFile);
  for (let depth = 0; depth < 10; depth++) {
    try {
      const manifestPath = join(current, "package.json");
      const helperModule = join(current, "audio-helper", "go.mod");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { name?: string };
      await access(helperModule, fsConstants.F_OK);
      if (manifest.name === "@alainux/orb") return current;
    } catch {
      // Keep walking. The source extension and compiled distribution have
      // different nesting depths, so fixed ../ traversal is intentionally
      // avoided here.
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(
    `Orb could not locate its package root from ${fromFile}. Expected package.json and audio-helper/go.mod in a parent directory.`,
  );
}

export async function findGoExecutable(): Promise<string | undefined> {
  for (const candidate of commonGoCandidates()) {
    try {
      await execFileAsync(candidate, ["version"], { env: process.env });
      return candidate;
    } catch {
      // Try the next common location. This matters on macOS when Pi is launched
      // without Homebrew's PATH even though `go` works in the user's shell.
    }
  }
  if (process.platform !== "win32") {
    const shells = [process.env.SHELL?.trim(), "/bin/zsh", "/bin/bash"].filter(Boolean) as string[];
    for (const shell of [...new Set(shells)]) {
      try {
        const resolved = (await execFileText(shell, ["-lc", "command -v go"], { env: process.env }))
          .trim()
          .split(/\r?\n/)
          .pop()
          ?.trim();
        if (resolved) {
          await execFileAsync(resolved, ["version"], { env: process.env });
          return resolved;
        }
      } catch {
        // Try the next shell. Version managers such as asdf/mise often expose
        // Go only after the user's login shell initializes.
      }
    }
  }
  return undefined;
}

async function downloadReleaseBinary(root: string, destination: string, log: RunLog): Promise<boolean> {
  const asset = releaseAssetName();
  const version = (process.env.ORB_AUDIO_RELEASE_VERSION?.trim() || await packageVersion(root)).replace(/^v/, "");
  const customBase = process.env.ORB_AUDIO_RELEASE_BASE_URL?.trim()?.replace(/\/$/, "");
  const urls = customBase
    ? [`${customBase}/${asset}`]
    : [
        `https://github.com/alainux/orb/releases/download/v${version}/${asset}`,
        `https://github.com/alainux/orb/releases/latest/download/${asset}`,
      ];

  for (const url of urls) {
    try {
      await log.info("trying Orb audio helper release", { asset, url });
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        await log.info("audio helper release unavailable", { url, status: response.status });
        continue;
      }
      const data = Buffer.from(await response.arrayBuffer());
      // Protect against accidentally caching an HTML error page or tiny proxy response.
      if (data.length < 16 * 1024) {
        await log.info("audio helper release rejected as implausibly small", { url, bytes: data.length });
        continue;
      }
      const temp = `${destination}.download-${process.pid}`;
      await writeFile(temp, data);
      if (process.platform !== "win32") await chmod(temp, 0o755);
      await rename(temp, destination);
      await ensureExecutable(destination);
      await log.info("downloaded Orb audio helper", { asset, destination, bytes: data.length });
      return true;
    } catch (error) {
      await log.info("audio helper download failed", { url, error: asError(error).message });
      try { await rm(`${destination}.download-${process.pid}`, { force: true }); } catch {}
    }
  }
  return false;
}

function audioCacheRoot(): string {
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA || homedir(), "Orb", "Cache", "audio");
  if (process.platform === "darwin") return join(homedir(), "Library", "Caches", "orb", "audio");
  return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "orb", "audio");
}

async function packageVersion(root: string): Promise<string> {
  try {
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version?: string };
    return manifest.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function existsExecutable(path: string): Promise<boolean> {
  try { await ensureExecutable(path); return true; } catch { return false; }
}
async function ensureExecutable(path: string): Promise<void> {
  await access(path, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
}
function execFileAsync(file: string, args: string[], options: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => execFile(file, args, options as any, (error, _stdout, stderr) => {
    if (error) reject(new Error(`${basename(file)} failed: ${String(stderr || error.message).trim()}`));
    else resolve();
  }));
}
function execFileText(file: string, args: string[], options: Record<string, unknown>): Promise<string> {
  return new Promise((resolve, reject) => execFile(file, args, options as any, (error, stdout, stderr) => {
    if (error) reject(new Error(`${basename(file)} failed: ${String(stderr || error.message).trim()}`));
    else resolve(String(stdout));
  }));
}
function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
