import { access, copyFile, mkdir, chmod } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const outDir = process.argv[2] ?? "release-assets";
const exe = process.platform === "win32" ? ".exe" : "";
const key = `${process.platform}-${process.arch}`;
const source = join("bin", key, `orb-audio${exe}`);
const platform = process.platform === "win32" ? "windows" : process.platform;
const target = join(outDir, `orb-audio-${platform}-${process.arch}${exe}`);

await access(source, process.platform === "win32" ? constants.F_OK : constants.X_OK);
await mkdir(outDir, { recursive: true });
await copyFile(source, target);
if (process.platform !== "win32") await chmod(target, 0o755);
console.log(target);
