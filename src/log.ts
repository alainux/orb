import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export class RunLog {
  readonly path: string;
  private chain: Promise<void> = Promise.resolve();

  private constructor(path: string) {
    this.path = path;
  }

  static async create(directory: string): Promise<RunLog> {
    await mkdir(directory, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
    const log = new RunLog(join(directory, `session-${stamp}-${process.pid}.log`));
    await log.info("log started");
    return log;
  }

  info(message: string, details?: unknown): Promise<void> {
    return this.write("INFO", message, details);
  }

  error(message: string, error?: unknown): Promise<void> {
    return this.write("ERROR", message, error);
  }

  private write(level: string, message: string, details?: unknown): Promise<void> {
    const suffix = details === undefined ? "" : ` ${safeJson(details)}`;
    const line = `${new Date().toISOString()} ${level} ${message}${suffix}\n`;
    this.chain = this.chain.then(() => appendFile(this.path, line, "utf8")).catch(() => undefined);
    return this.chain;
  }
}

function safeJson(value: unknown): string {
  if (value instanceof Error) {
    return JSON.stringify({ name: value.name, message: value.message, stack: value.stack });
  }
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(String(value));
  }
}
