#!/usr/bin/env node
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const built = fileURLToPath(new URL("../dist/extensions/voice.js", import.meta.url));
const source = fileURLToPath(new URL("../extensions/voice.ts", import.meta.url));
let extension = built;
try { await access(built); } catch { extension = source; }

const piCommand = process.platform === "win32" ? "pi.cmd" : "pi";
const args = process.argv.slice(2);
const child = spawn(piCommand, ["-e", extension, ...args], {
  stdio: "inherit",
  env: { ...process.env, ORB_AUTO_START: process.env.ORB_AUTO_START ?? "1" },
  shell: false,
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => { try { child.kill(signal); } catch {} });
}
child.on("error", (error) => {
  console.error(`orb: could not launch Pi: ${error.message}`);
  console.error("Install Pi first: https://pi.dev");
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.exitCode = 1;
  else process.exitCode = code ?? 0;
});
