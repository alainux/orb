import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, SettingsList, type SettingItem } from "@earendil-works/pi-tui";
import { parseVoiceCommand } from "../src/commands.js";
import { resolveAutoStartVoice, thinkingDisplayValue } from "../src/config.js";
import { VoiceController } from "../src/controller.js";
import type { EditableSetting } from "../src/settings.js";
import { normalizePanelKey } from "../src/settings.js";
import { voiceOptions } from "../src/voices.js";

/**
 * `/voice settings` — a Pi SettingsList panel (tui.md Pattern 3). Rows come from
 * the controller's settings catalog: the reasoning *reveal* is a live session
 * toggle; provider/voice/auto-start are editable durable preferences (persisted
 * to the user config); the remaining durable config values are shown read-only
 * (edit those in the config file). No search mode — every key visibly moves the
 * cursor, cycles a value, or closes the panel.
 */
async function showVoiceSettings(controller: VoiceController, ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI || ctx.mode !== "tui") {
    ctx.ui.notify("Orb settings requires the interactive TUI.", "warning");
    return;
  }
  await ctx.ui.custom(async (_tui, theme, _kb, done) => {
    const rows = (await controller.getVoiceSettings(ctx.cwd)).map((row) => ({
      id: row.id,
      label: `${row.group}  ${row.label}`,
      description: row.description,
      currentValue: row.currentValue,
      ...(row.values ? { values: row.values } : {}),
    })) as SettingItem[];

    const container = new Container();
    container.addChild(new (class {
      render(_width: number): string[] { return [theme.fg("accent", theme.bold("Orb Voice Settings")), ""]; }
      invalidate(): void {}
    })());
    const list = new SettingsList(
      rows,
      Math.min(rows.length + 2, 16),
      getSettingsListTheme(),
      (id: string, newValue: string) => {
        // Keep the voice row's cycle list in sync with the provider row: a
        // voice selected for one provider is meaningless for the other.
        if (id === "provider") {
          const provider = newValue === "openai" ? "openai" : "gemini";
          const voiceRow = rows.find((r) => r.id === "voice");
          if (voiceRow) {
            voiceRow.values = voiceOptions(provider);
            if (!voiceRow.values.includes(voiceRow.currentValue)) {
              voiceRow.currentValue = voiceRow.values[0]!;
            }
            list.updateValue("voice", voiceRow.currentValue);
          }
        }
        void controller.applyVoiceSetting(id as EditableSetting, newValue, ctx);
        list.updateValue(id, newValue);
      },
      () => done?.(undefined),
    );
    container.addChild(list);
    return {
      render: (width: number): string[] => container.render(width),
      invalidate: (): void => container.invalidate(),
      handleInput: (data: string): void => { list.handleInput?.(normalizePanelKey(data)); },
    };
  });
}

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
    case "settings": await showVoiceSettings(controller, ctx); break;
    case "scratchpad": await controller.scratchpadCommand(command.scratchpadAction, command.argument, ctx); break;
    case "help": ctx.ui.notify("/voice [start [gemini|openai]] · /voice status · /voice log · /voice provider <name> · /voice mute [on|off] · /voice thinking [full|minimized|hidden] · /voice settings · /voice voice [name|list] · /voice scratchpad [open|view|edit|load|save|dispatch|close] · /voice stop", "info"); break;
  }
}
