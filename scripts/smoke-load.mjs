import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const temp = await mkdtemp(join(tmpdir(), "pi-voice-smoke-"));
try {
  await cp(new URL("../dist", import.meta.url), join(temp, "dist"), { recursive: true });
  await writeFile(join(temp, "package.json"), JSON.stringify({ type: "module" }));

  const genai = join(temp, "node_modules", "@google", "genai");
  const ws = join(temp, "node_modules", "ws");
  await mkdir(genai, { recursive: true });
  await mkdir(ws, { recursive: true });
  await writeFile(join(genai, "package.json"), JSON.stringify({ name: "@google/genai", type: "module", exports: "./index.js" }));
  await writeFile(join(genai, "index.js"), 'export const Modality={AUDIO:"AUDIO"}; export class GoogleGenAI {}\n');
  await writeFile(join(ws, "package.json"), JSON.stringify({ name: "ws", type: "module", exports: "./index.js" }));
  await writeFile(join(ws, "index.js"), 'export default class WebSocket { static OPEN=1; }\n');

  const extension = (await import(pathToFileURL(join(temp, "dist", "extensions", "voice.js")).href)).default;
  const registered = { commands: [], shortcuts: [], events: [] };
  extension({
    registerCommand(name, options) { registered.commands.push([name, options]); },
    registerShortcut(key, options) { registered.shortcuts.push([key, options]); },
    on(event, handler) { registered.events.push([event, handler]); },
    sendUserMessage() {},
  });
  if (registered.commands[0]?.[0] !== "voice") throw new Error("voice command was not registered");
  if (registered.shortcuts.length !== 1) throw new Error("voice shortcut was not registered");
  if (!registered.events.some(([name]) => name === "session_start")) throw new Error("session start hook was not registered");
  if (!registered.events.some(([name]) => name === "session_shutdown")) throw new Error("shutdown hook was not registered");
  for (const required of ["agent_start", "agent_end", "message_update", "message_end", "tool_execution_start", "tool_execution_end"]) {
    if (!registered.events.some(([name]) => name === required)) throw new Error(`${required} hook was not registered`);
  }
  console.log("dist extension smoke-load passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}
