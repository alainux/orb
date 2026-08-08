import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, SettingsList, type SettingItem } from "@earendil-works/pi-tui";
import { parseVoiceCommand } from "../src/commands.js";
import { resolveAutoStartVoice, thinkingDisplayValue } from "../src/config.js";
import { VoiceController } from "../src/controller.js";
import type { PrefKey } from "../src/settings.js";

const INSTANCE_KEY = Symbol.for("alainux.orb.voice-extension");

/**
 * Canonical settings panel (Pi docs tui.md "Pattern 3 - Settings/Toggles" and
 * examples/extensions/tools.ts). Renders every user preference from the
 * controller's shared catalog (src/settings.ts) as a SettingsList; changes are
 * pushed through the controller, which persists them via the canonical session
 * entry (appendEntry) — never by writing to the user's config file.
 */
async function showVoiceSettings(controller: VoiceController, ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI || ctx.mode !== "tui") {
    ctx.ui.notify("Orb settings requires the interactive TUI.", "warning");
    return;
  }
  await ctx.ui.custom((_tui, theme, _kb, done) => {
    const buildItems = (): SettingItem[] =>
      controller.getSettings().map((row) => ({
        id: row.id,
        label: `${row.group}  ${row.label}`,
        description: row.description,
        currentValue: row.currentValue,
        values: row.values,
      }));

    const items = buildItems();
    const container = new Container();
    container.addChild(new (class {
      render(_width: number) { return [theme.fg("accent", theme.bold("Orb Voice Settings")), ""]; }
      invalidate() {}
    })());
    const list = new SettingsList(
      items,
      Math.min(items.length + 2, 15),
      getSettingsListTheme(),
      (id, newValue) => {
        controller.setPref(id as PrefKey, newValue, ctx);
        list.updateValue(id, newValue);
      },
      () => done?.(undefined),
      { enableSearch: true },
    );
    container.addChild(list);
    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => { list.handleInput?.(data); },
    };
  });
}

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
  pi.registerShortcut("ctrl+alt+t", {
    description: "Cycle Orb thinking display (minimized / full / hidden)",
    handler: async (ctx) => {
      if (!controller.active) { ctx.ui.notify("Start Orb voice before toggling the thinking display.", "warning"); return; }
      controller.cycleThinkingDisplay(ctx);
    },
  });

  const forward = (eventName: string) => (event: unknown, ctx: ExtensionContext) => controller.recordPiEvent(eventName, event, ctx);
  for (const eventName of ["agent_start", "agent_end", "message_update", "message_end", "tool_execution_start", "tool_execution_end", "model_select"]) pi.on(eventName, forward(eventName));

  // Current Pi exposes user_bash for ! / !! commands. Recording the command
  // gives Orb a more complete observable project history without intercepting
  // or altering Pi's normal shell execution path.
  pi.on("user_bash", (event: unknown, ctx: ExtensionContext) => { controller.recordUserBash(event, ctx); return undefined; });

  pi.on("session_start", async (_event, ctx) => {
    // Auto-start is on by default; opt out via the `autoStartVoice` config key
    // (or `ORB_AUTO_START=false`). Consulted before any session exists, so it
    // never requires provider API keys.
    if (await resolveAutoStartVoice(ctx.cwd)) {
      try { await controller.start(ctx); } catch (error) { ctx.ui.notify(`Orb auto-start failed: ${error instanceof Error ? error.message : String(error)}`, "error"); }
    }
  });
  pi.on("session_shutdown", async (_event, ctx) => { await controller.stop(ctx, { quiet: true }); });
  // Restore a display preference saved in the current branch on branch
  // navigation (canonical `appendEntry` restore, as in examples/tools.ts).
  pi.on("session_tree", async (_event, ctx) => { controller.restorePrefs(ctx); });
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
    case "thinking":
      if (command.value === undefined) controller.cycleThinkingDisplay(ctx);
      else controller.setThinkingDisplay(thinkingDisplayValue(command.value, "minimized", "thinking display"), ctx);
      break;
    case "scratchpad": await controller.scratchpadCommand(command.scratchpadAction, command.argument, ctx); break;
    case "settings": await showVoiceSettings(controller, ctx); break;
    case "help": ctx.ui.notify("/voice [start [gemini|openai]] · /voice status · /voice log · /voice provider <name> · /voice mute [on|off] · /voice thinking [full|minimized|hidden] · /voice settings · /voice voice [name|list] · /voice scratchpad [open|view|edit|load|save|dispatch|close] · /voice stop", "info"); break;
  }
}
