import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseVoiceCommand } from "../src/commands.js";
import { VoiceController } from "../src/controller.js";

const INSTANCE_KEY = Symbol.for("alainux.orb.voice-extension");

export default function orbVoiceExtension(pi: ExtensionAPI): void {
  const globalState = globalThis as unknown as Record<symbol, boolean>;
  if (globalState[INSTANCE_KEY]) return;
  globalState[INSTANCE_KEY] = true;

  const controller = new VoiceController(pi);
  pi.registerCommand("voice", {
    description: "Start or manage Orb's full-duplex voice mode for Pi",
    handler: async (args, ctx) => {
      try { await handleVoiceCommand(controller, args, ctx); }
      catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); }
    },
  });
  pi.registerShortcut("ctrl+alt+v", {
    description: "Start or stop Orb voice",
    handler: async (ctx) => { if (controller.active) await controller.stop(ctx); else await controller.start(ctx); },
  });
  pi.registerShortcut("ctrl+alt+m", {
    description: "Mute or unmute Orb's microphone",
    handler: async (ctx) => { if (!controller.active) { ctx.ui.notify("Start Orb voice before muting the microphone.", "warning"); return; } controller.setMuted(ctx); },
  });

  const forward = (eventName: string) => (event: unknown, ctx: ExtensionContext) => controller.recordPiEvent(eventName, event, ctx);
  for (const eventName of ["agent_start", "agent_end", "message_update", "message_end", "tool_execution_start", "tool_execution_end", "model_select"]) pi.on(eventName, forward(eventName));

  // Current Pi exposes user_bash for ! / !! commands. Recording the command
  // gives Orb a more complete observable project history without intercepting
  // or altering Pi's normal shell execution path.
  pi.on("user_bash", (event: unknown, ctx: ExtensionContext) => { controller.recordUserBash(event, ctx); return undefined; });

  pi.on("session_start", async (_event, ctx) => {
    if (process.env.ORB_AUTO_START === "1" || process.env.ORB_AUTO_START === "true") {
      try { await controller.start(ctx); } catch (error) { ctx.ui.notify(`Orb auto-start failed: ${error instanceof Error ? error.message : String(error)}`, "error"); }
    }
  });
  pi.on("session_shutdown", async (_event, ctx) => { await controller.stop(ctx, { quiet: true }); });
}

export async function handleVoiceCommand(controller: VoiceController, rawArgs: string, ctx: ExtensionCommandContext): Promise<void> {
  const command = parseVoiceCommand(rawArgs);
  switch (command.action) {
    case "start": await controller.start(ctx, command.provider); break;
    case "stop": await controller.stop(ctx); break;
    case "status": controller.status(ctx); break;
    case "log": controller.showDiagnostics(ctx); break;
    case "provider": controller.setProvider(command.provider, ctx); break;
    case "mute": controller.setMuted(ctx, command.muted); break;
    case "voice": controller.setVoice(command.voice, ctx); break;
    case "scratchpad": await controller.scratchpadCommand(command.scratchpadAction, command.argument, ctx); break;
    case "help": ctx.ui.notify("/voice [start [gemini|openai]] · /voice status · /voice log · /voice provider <name> · /voice mute [on|off] · /voice voice [name|list] · /voice scratchpad [open|view|edit|load|save|dispatch|close] · /voice stop", "info"); break;
  }
}
