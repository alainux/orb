declare function fetch(input: string, init?: any): Promise<any>;
declare const AbortSignal: { timeout(ms: number): any };
declare type Buffer = any;
declare const Buffer: any;
declare const process: any;
declare const console: { log(...args: any[]): void; error(...args: any[]): void; warn(...args: any[]): void };
declare const performance: { now(): number };
declare class URL { constructor(input: string, base?: string | URL); }
interface ImportMeta { url: string; }
declare function setInterval(callback: (...args: any[]) => void, ms?: number, ...args: any[]): NodeJS.Timeout;
declare function clearInterval(timeout: NodeJS.Timeout | undefined): void;
declare function setTimeout(callback: (...args: any[]) => void, ms?: number, ...args: any[]): NodeJS.Timeout;
declare function clearTimeout(timeout: NodeJS.Timeout | undefined): void;
declare namespace NodeJS { interface Timeout { unref?(): void } }

declare module "node:events" {
  export class EventEmitter {
    on(event: string | symbol, listener: (...args: any[]) => void): this;
    once(event: string | symbol, listener: (...args: any[]) => void): this;
    off(event: string | symbol, listener: (...args: any[]) => void): this;
    emit(event: string | symbol, ...args: any[]): boolean;
  }
}
declare module "node:worker_threads" {
  import { EventEmitter } from "node:events";
  export const workerData: any;
  export const parentPort: ({
    postMessage(value: any, transferList?: any[]): void;
    on(event: "message", listener: (value: any) => void): void;
    close(): void;
  }) | null;
  export class Worker extends EventEmitter {
    constructor(filename: URL | string, options?: { workerData?: any });
    postMessage(value: any, transferList?: any[]): void;
    terminate(): Promise<number>;
  }
}
declare module "node:stream" {
  import { EventEmitter } from "node:events";
  export class Duplex extends EventEmitter { write(chunk: any): boolean; }
}
declare module "node:fs/promises" {
  export function appendFile(path: string, data: string, encoding?: string): Promise<void>;
  export function mkdir(path: string, options?: any): Promise<void>;
  export function readFile(path: string, encoding?: string): Promise<any>;
  export function writeFile(path: string, data: any, encoding?: string): Promise<void>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function rm(path: string, options?: any): Promise<void>;
  export function chmod(path: string, mode: number): Promise<void>;
  export function rename(oldPath: string, newPath: string): Promise<void>;
  export function stat(path: string): Promise<{ isFile(): boolean; size: number }>;
}
declare module "node:path" {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string): string;
  export function isAbsolute(path: string): boolean;
  export function relative(from: string, to: string): string;
}
declare module "node:os" {
  export function homedir(): string;
  export function tmpdir(): string;
}
declare module "node:test" { export default function test(name: string, fn: (t?: any) => any): void; }
declare module "node:assert/strict" { const assert: any; export default assert; }
declare module "node:fs/promises" { export function access(path:string, mode?:number):Promise<void>; }
declare module "node:fs" { export const constants: { F_OK:number; X_OK:number }; }
declare module "node:url" { export function fileURLToPath(url: URL | string): string; export function pathToFileURL(path:string):URL; }
declare module "node:child_process" {
  import { EventEmitter } from "node:events";
  export interface ChildProcessWithoutNullStreams extends EventEmitter { stdin:any; stdout:any; stderr:any; kill(signal?:string):boolean; }
  export function spawn(file:string,args?:string[],options?:any):ChildProcessWithoutNullStreams;
  export function execFile(file:string,args:any[],options:any,callback:(error:any,stdout:string,stderr:string)=>void):any;
}
