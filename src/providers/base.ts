import type { VoiceProviderSink } from "../types.js";
import { mergeTranscript } from "./util.js";

export abstract class BaseProvider {
  protected sink?: VoiceProviderSink;
  protected closed = false;
  protected inputTranscript = "";
  protected outputTranscript = "";

  protected resetInput(final: boolean, text: string): void {
    this.inputTranscript = final ? "" : mergeTranscript(this.inputTranscript, text);
    this.sink?.onInputTranscript(final ? (text.trim() || this.inputTranscript) : this.inputTranscript, final);
  }

  protected resetOutput(final: boolean, text: string): void {
    this.outputTranscript = final ? "" : mergeTranscript(this.outputTranscript, text);
    this.sink?.onOutputTranscript(final ? (text.trim() || this.outputTranscript) : this.outputTranscript, final);
  }
}
