/**
 * Test-only seams.
 *
 * The realtime providers and the controller keep their transport and view-model
 * internals `private` on purpose (no accidental network I/O or state poke from
 * normal callers). A few tests must still drive those internals directly — feed
 * synthetic wire messages, inject a fake sink, or stub a controller field. Those
 * tests used to scatter `(x as any).privateMember` everywhere, which both masked
 * future renames and leaked `any` through the suite.
 *
 * These helpers are the single, documented place that structure is exposed to
 * the test suite. Keep the members here as precise as the tests need, never
 * broaden them for convenience, and add a comment when a shape is intentionally
 * loosened to admit a fake.
 */

import type { Scratchpad } from "../../src/scratchpad.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  ToolCall,
  VoiceConfig,
  VoiceProvider,
  VoiceProviderSink,
  VoiceViewState,
} from "../../src/types.js";

/** The wire-facing surface tests reach on the realtime providers. */
export interface ProviderSeam {
  /** Fake sink injected to observe transcript/audio/thinking transitions.
   * `unknown` so a test may install any partial handler-fake object. */
  sink: unknown;
  /** Gemini `LiveSession` — only ever assigned inside `connect()`. */
  session: unknown;
  /** OpenAI WebSocket — only ever assigned inside `connect()`. */
  socket: unknown;
  /** Dedupe set that guards against re-delivered tool callbacks. */
  handledCalls: Set<string>;
  /** Sole network entry point (the suite never calls it). */
  connect(): Promise<void>;
  /** Synchronous routing of an inbound provider message (no I/O). */
  handleMessage(message: unknown): Promise<void>;
  /** Extracting+running of function calls from a message (no network). */
  processToolCalls(calls: unknown): Promise<void>;
}

/** View the provider as its test seam (never used outside tests/). */
export function providerSeam<P extends object>(provider: P): ProviderSeam {
  return provider as unknown as ProviderSeam;
}

/**
 * Members the controller tests reach through, with minimal, fake-friendly
 * shapes. `config`/`state`/`provider` are deliberately lenient so tests can
 * install a partial config, a bare view-state stub, or a sendText-only fake.
 */
export interface ControllerSeam {
  config: Partial<VoiceConfig> & Record<string, unknown>;
  provider: Partial<VoiceProvider>;
  state: Partial<VoiceViewState>;
  ctx: unknown;
  log: unknown;
  scratchpad: Scratchpad;
  handleToolCall(call: ToolCall): Promise<Record<string, unknown>>;
  toolScratchpad(call: ToolCall): Promise<Record<string, unknown>>;
  scratchpadCommand(action: unknown, argument: unknown, ctx: unknown): Promise<unknown>;
  setVoice(voice: string | undefined, ctx: unknown): void;
  createProviderSink(): VoiceProviderSink;
}

/** View the controller as its test seam (never used in production). */
export function controllerSeam<C extends object>(controller: C): ControllerSeam {
  return controller as unknown as ControllerSeam;
}

/** A shapeless PiAPI stub for constructing objects whose constructor needs one. */
export function fakePi(): ExtensionAPI {
  return {} as unknown as ExtensionAPI;
}