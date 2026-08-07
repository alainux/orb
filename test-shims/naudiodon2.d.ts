declare module "naudiodon2" {
  import { Duplex } from "node:stream";
  export const SampleFormat16Bit: number;
  export class AudioIO extends Duplex {
    constructor(options: Record<string, unknown>);
    start(): void;
    quit(callback?: () => void): void;
  }
  const api: {
    AudioIO: typeof AudioIO;
    SampleFormat16Bit: number;
  };
  export default api;
}
