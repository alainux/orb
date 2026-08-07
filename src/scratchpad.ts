import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { ScratchpadConfig, ScratchpadViewState } from "./types.js";

export class Scratchpad {
  private state: ScratchpadViewState = { open: false, title: "Scratchpad", content: "", dirty: false };
  private sourcePath: string | undefined;

  constructor(private readonly cwd: string, private readonly config: ScratchpadConfig, private readonly allowOutsideProject: boolean) {}

  snapshot(): ScratchpadViewState { return { ...this.state }; }

  open(title?: string): ScratchpadViewState {
    this.state.open = true;
    if (title?.trim()) this.state.title = title.trim().slice(0, 120);
    return this.snapshot();
  }

  close(): ScratchpadViewState { this.state.open = false; return this.snapshot(); }

  replace(content: string, title?: string): ScratchpadViewState {
    this.assertSize(content);
    this.state.open = true;
    this.state.content = content;
    this.state.dirty = true;
    if (title?.trim()) this.state.title = title.trim().slice(0, 120);
    return this.snapshot();
  }

  append(content: string): ScratchpadViewState {
    const next = this.state.content ? `${this.state.content}${this.state.content.endsWith("\n") ? "" : "\n"}${content}` : content;
    return this.replace(next);
  }

  async load(path: string): Promise<ScratchpadViewState> {
    const resolved = this.resolvePath(path);
    const info = await stat(resolved);
    if (!info.isFile()) throw new Error(`Scratchpad source is not a file: ${resolved}`);
    if (info.size > this.config.maxBytes) throw new Error(`Scratchpad file exceeds ${this.config.maxBytes} bytes: ${resolved}`);
    const content = await readFile(resolved, "utf8");
    this.assertSize(content);
    this.state = { open: true, title: pathLabel(resolved), content, dirty: false };
    this.sourcePath = resolved;
    return this.snapshot();
  }

  async save(path?: string): Promise<{ path: string; state: ScratchpadViewState }> {
    const target = this.resolvePath(path?.trim() || this.sourcePath || "orb-scratchpad.md");
    this.assertSize(this.state.content);
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.orb-${process.pid}-${Date.now()}.tmp`;
    try {
      await writeFile(temp, this.state.content, "utf8");
      await rename(temp, target);
    } finally {
      await rm(temp, { force: true }).catch(() => {});
    }
    this.sourcePath = target;
    this.state.title = pathLabel(target);
    this.state.dirty = false;
    return { path: target, state: this.snapshot() };
  }

  private resolvePath(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) throw new Error("path must be non-empty");
    const resolved = resolve(isAbsolute(trimmed) ? trimmed : resolve(this.cwd, trimmed));
    if (!this.allowOutsideProject) {
      const rel = relative(this.cwd, resolved);
      if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
        throw new Error(`Scratchpad file access is restricted to the Pi project: ${this.cwd}`);
      }
    }
    return resolved;
  }

  private assertSize(content: string): void {
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > this.config.maxBytes) throw new Error(`Scratchpad exceeds ${this.config.maxBytes} bytes`);
  }
}

function pathLabel(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).at(-1) || "Scratchpad";
}
