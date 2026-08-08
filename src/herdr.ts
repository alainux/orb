/**
 * Thin, read-only client for the `herdr` terminal multiplexer CLI.
 *
 * The voice agent uses Herdr panes as a window into terminals it (or another
 * agent) is running concurrently. This module gives the companion a safe,
 * read-only path to (a) discover the running panes and (b) read the recent
 * terminal output of an open pane — Herdr's own on-disk logs are
 * metadata/telemetry only, so it does NOT carry pane contents. Open-pane
 * output is read straight from the live Terminal buffer via
 * `herdr pane read <pane_id> --source recent-unwrapped --lines N`.
 *
 * Availability is "contingent on herdr being installed": every operation
 * reports an `installed` flag so a caller can tell the human "herdr is not
 * installed / not running" instead of failing silently. Nothing here writes
 * to the project, starts a shell, or modifies herdr state — it only lists
 * panes and reads their output.
 */

import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";

/** Selectable Herdr read sources (see `herdr pane read`). */
export const HERDR_READ_SOURCES = ["visible", "recent", "recent-unwrapped", "detection"] as const;
export type HerdrReadSource = (typeof HERDR_READ_SOURCES)[number];

/** Public pane record surfaced by `herdr pane list`. */
export interface HerdrPane {
  pane_id: string;
  tab_id?: string;
  workspace_id?: string;
  agent?: string;
  cwd?: string;
  terminal_title?: string;
  terminal_title_stripped?: string;
}

export const HERDR_DEFAULT_LINES = 120;
/** Hard cap on how many terminal rows the voice model may request at once. */
export const HERDR_MAX_LINES = 2000;
/** Prevent an unbounded pane read from swamping the voice turn. */
export const HERDR_MAX_OUTPUT_CHARS = 60_000;

export interface HerdrCommandResult {
  ok: boolean;
  installed: boolean;
  error?: string;
}

export interface HerdrListResult extends HerdrCommandResult {
  panes: HerdrPane[];
}

export interface HerdrReadResult extends HerdrCommandResult {
  pane_id: string;
  source: HerdrReadSource;
  lines: number;
  log: string;
  truncated: boolean;
}

interface ExecOutcome {
  stdout: string;
  exitCode: number | null;
  message: string;
}

/** Resolve the `herdr` executable: explicit `HERDR_BIN`, else on `PATH`. */
export async function resolveHerdrBinary(): Promise<string | null> {
  const explicit = process.env.HERDR_BIN?.trim();
  if (explicit) return explicit;
  try {
    const out = await execCapture("which", ["herdr"]);
    const line = out.stdout.split("\n")[0]?.trim();
    return line || null;
  } catch {
    return null;
  }
}

/**
 * True when a working herdr binary is detected in this environment.
 *
 * An explicit `HERDR_BIN` that does not resolve to an executable still counts
 * as "not installed", so a stale or broken override never silently enables the
 * tool. Never throws: returns false whenever herdr is missing or unreachable,
 * so callers (e.g. tool registration) can degrade silently on a missing herdr.
 */
export async function herdrInstalled(): Promise<boolean> {
  const bin = await resolveHerdrBinary();
  if (!bin) return false;
  try {
    await access(bin, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Run herdr with args; never throws. Distinguishes missing binary vs CLI error. */
async function runHerdr(
  args: string[],
): Promise<{ outcome: ExecOutcome; installed: boolean }> {
  const bin = await resolveHerdrBinary();
  if (!bin) {
    return {
      installed: false,
      outcome: { stdout: "", exitCode: null, message: "herdr is not installed or unreachable" },
    };
  }
  try {
    const out = await execCapture(bin, args);
    return { installed: true, outcome: { stdout: out.stdout, exitCode: 0, message: "ok" } };
  } catch (error) {
    const out = errorCapsule(error);
    // ENOENT (or exit code 127) means the resolved binary does not actually run.
    const missing = out.code === "ENOENT" || (out.exited && out.code === 127);
    const installed = !missing;
    const exitCode: number | null = out.exited && typeof out.code === "number" ? out.code : null;
    return { installed, outcome: { stdout: out.stdout, exitCode, message: out.message } };
  }
}

/**
 * Capture a subprocess's stdout as UTF-8 text.
 *
 * We use execFile's callback form (instead of promisify) so the resolved value
 * is always `{ stdout: string }` regardless of execFile's overload selection.
 */
function execCapture(bin: string, args: string[]): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { encoding: "utf8", maxBuffer: HERDR_MAX_OUTPUT_CHARS * 4, timeout: 30_000 },
      (error, stdout) => {
        const text = typeof stdout === "string" ? stdout : String(stdout ?? "");
        if (error) {
          (error as { stdout?: unknown }).stdout = text;
          reject(error);
        } else {
          resolve({ stdout: text });
        }
      },
    );
  });
}

/** Deconstruct an exec rejection into a stable capsule (no `unknown` leaks). */
function errorCapsule(error: unknown): { stdout: string; code: number | string | null; exited: boolean; message: string } {
  const err = error as { stdout?: unknown; code?: unknown; signal?: unknown; message?: unknown };
  const stdout = typeof err.stdout === "string" ? err.stdout : "";
  const numeric = Number(err.code);
  const exited = typeof err.code === "number" || typeof err.code === "string" || err.code !== undefined;
  const message = error instanceof Error ? error.message : String(error);
  const code = exited && Number.isFinite(numeric) && typeof err.code === "number" ? err.code : (err.code === "ENOENT" ? "ENOENT" : null);
  return { stdout, code, exited, message };
}

/** List open herdr panes. Returns a structured, version-tolerant list. */
export async function listHerdrPanes(): Promise<HerdrListResult> {
  const { outcome, installed } = await runHerdr(["pane", "list"]);
  if (!installed) return { ok: false, installed, panes: [], error: "herdr is not installed" };
  if (outcome.exitCode !== 0) {
    const msg = outcome.message.replace(/\s+/g, " ").trim();
    return { ok: false, installed, panes: [], error: msg && msg !== "ok" ? `herdr: ${msg}` : "herdr pane list exited with an error" };
  }
  const raw = parseJson(outcome.stdout);
  const rows = raw?.result?.panes ?? raw?.panes;
  if (!Array.isArray(rows)) {
    return { ok: false, installed, panes: [], error: "unexpected `herdr pane list` response" };
  }
  const panes = rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const rec = row as Record<string, unknown>;
    const id = typeof rec.pane_id === "string" ? rec.pane_id : "";
    if (!id) return [];
    const pane: HerdrPane = { pane_id: id };
    for (const key of ["tab_id", "workspace_id", "cwd", "terminal_title", "terminal_title_stripped"] as const) {
      if (typeof rec[key] === "string") pane[key] = rec[key];
    }
    if (typeof rec.agent === "string" && rec.agent) pane.agent = rec.agent;
    // Always surface a human-readable pane name so callers can select by title:
    // prefer the plain title, falling back to the stripped (unstyled) variant.
    if (!pane.terminal_title && pane.terminal_title_stripped) {
      pane.terminal_title = pane.terminal_title_stripped;
    }
    return [pane];
  });
  return { ok: true, installed, panes };
}

/**
 * Read recent output of an open pane, using Herdr's unwrapped scrollback
 * source which is the recommended choice for reading logs (it joins terminal
 * soft-wrap so a single content line stays a single line). `recent-wrapped` is
 * the default; pass `source` only to override.
 */
export async function readHerdrPane(
  paneId: string,
  options: { lines?: number; source?: HerdrReadSource } = {},
): Promise<HerdrReadResult> {
  const source: HerdrReadSource = options.source ?? "recent-unwrapped";
  const lines = clampLines(options.lines);
  const { outcome, installed } = await runHerdr([
    "pane", "read", paneId, "--source", source, "--lines", String(lines),
  ]);
  if (!installed) {
    return { ok: false, installed, pane_id: paneId, source, lines, log: "", truncated: false, error: "herdr is not installed" };
  }
  if (outcome.exitCode !== 0) {
    return { ok: false, installed, pane_id: paneId, source, lines, log: "", truncated: false, error: herdrPaneReadError(outcome) };
  }
  const log = trimTrailingNewline(outcome.stdout);
  // Long reads (default 120 rows × wide panes) can exceed the LLM turn budget.
  const truncated = log.length > HERDR_MAX_OUTPUT_CHARS;
  return { ok: true, installed, pane_id: paneId, source, lines, log: truncated ? `${log.slice(0, HERDR_MAX_OUTPUT_CHARS)}\n… (truncated by Orb)` : log, truncated };
}

function clampLines(value: number | undefined): number {
  if (!Number.isFinite(Number(value))) return HERDR_DEFAULT_LINES;
  return Math.max(1, Math.min(HERDR_MAX_LINES, Math.floor(Number(value))));
}

function herdrPaneReadError(outcome: ExecOutcome): string {
  const detail = extractJsonError(outcome.stdout);
  if (detail) return detail;
  const msg = outcome.message.replace(/\s+/g, " ").trim();
  if (msg && msg !== "ok") return `herdr: ${msg}`;
  return "herdr pane read exited with an error";
}

/** Pull a human-readable error out of Herdr's JSON error envelope, if any. */
function extractJsonError(stdout: string): string | undefined {
  const json = parseJson(stdout);
  if (!json) return undefined;
  const err = json.error;
  if (err === undefined) return undefined;
  const detail = typeof err === "string" ? err : JSON.stringify(err);
  const clean = detail.replace(/\s+/g, " ").trim();
  return clean ? `herdr: ${clean.slice(0, 240)}` : "herdr pane read failed";
}

/** Trim a single trailing newline (keep internal formatting intact). */
function trimTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}

function parseJson(
  text: string,
): { result: Record<string, unknown> | undefined; panes: unknown; error: unknown } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      const rec = parsed as Record<string, unknown>;
      const result = rec.result && typeof rec.result === "object" ? rec.result as Record<string, unknown> : undefined;
      return { result, panes: rec.panes, error: rec.error };
    }
  } catch {
    return null;
  }
  return null;
}