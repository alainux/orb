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

  // The dist extension statically imports the pi-axis peer deps (native tool
  // factories and TUI components). They are only ever invoked lazily inside
  // the running extension, so loading the bundle needs value bindings, not
  // working implementations. Stub them just like genai/ws above.
  const agent = join(temp, "node_modules", "@earendil-works", "pi-coding-agent");
  const tui = join(temp, "node_modules", "@earendil-works", "pi-tui");
  await mkdir(agent, { recursive: true });
  await mkdir(tui, { recursive: true });
  const toolNames = ["createBashTool", "createBashToolDefinition", "createEditTool", "createEditToolDefinition", "createFindTool", "createFindToolDefinition", "createGrepTool", "createGrepToolDefinition", "createLsTool", "createLsToolDefinition", "createReadTool", "createReadToolDefinition", "createWriteTool", "createWriteToolDefinition"].map((n) => `export const ${n}=()=>({});`).join('\n');
  await writeFile(join(agent, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", type: "module", exports: "./index.js" }));
  await writeFile(join(agent, "index.js"), `${toolNames}\n`);
  await writeFile(join(tui, "package.json"), JSON.stringify({ name: "@earendil-works/pi-tui", type: "module", exports: "./index.js" }));
  await writeFile(join(tui, "index.js"), 'export const Markdown=()=>null; export const ScrollView=()=>null; export const matchesKey=()=>false; export const truncateToWidth=(t)=>t; export const visibleWidth=(t)=>t?.length??0;\n');


  const extension = (await import(pathToFileURL(join(temp, "dist", "extensions", "voice.js")).href)).default;
  const registered = { commands: [], shortcuts: [], events: [] };
  extension({
    registerCommand(name, options) { registered.commands.push([name, options]); },
    registerShortcut(key, options) { registered.shortcuts.push([key, options]); },
    on(event, handler) { registered.events.push([event, handler]); },
    sendUserMessage() {},
  });
  if (registered.commands[0]?.[0] !== "voice") throw new Error("voice command was not registered");
  if (registered.shortcuts.length !== 3) throw new Error("voice shortcuts were not registered (expected ctrl+alt+v, ctrl+alt+m, ctrl+alt+t)");
  if (!registered.shortcuts.some(([key]) => key === "ctrl+alt+v")) throw new Error("ctrl+alt+v voice shortcut was not registered");
  if (!registered.shortcuts.some(([key]) => key === "ctrl+alt+m")) throw new Error("ctrl+alt+m mute shortcut was not registered");
  if (!registered.shortcuts.some(([key]) => key === "ctrl+alt+t")) throw new Error("ctrl+alt+t thinking-display shortcut was not registered");
  if (!registered.events.some(([name]) => name === "session_start")) throw new Error("session start hook was not registered");
  if (!registered.events.some(([name]) => name === "session_shutdown")) throw new Error("shutdown hook was not registered");
  for (const required of ["agent_start", "agent_end", "message_update", "message_end", "tool_execution_start", "tool_execution_end"]) {
    if (!registered.events.some(([name]) => name === required)) throw new Error(`${required} hook was not registered`);
  }
  console.log("dist extension smoke-load passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}
