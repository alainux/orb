declare module "ws" {
  import { EventEmitter } from "node:events";
  export default class WebSocket extends EventEmitter {
    static OPEN: number;
    readyState: number;
    constructor(url: string, options?: { headers?: Record<string, string> });
    send(data: string | Buffer): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
    on(event: "open", listener: () => void): this;
    on(event: "message", listener: (data: Buffer | string) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "close", listener: (code: number, reason: Buffer) => void): this;
  }
}
