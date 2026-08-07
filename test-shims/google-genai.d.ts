declare module "@google/genai" {
  export const Modality: { AUDIO: string };
  export class GoogleGenAI {
    constructor(options?: { apiKey?: string });
    live: {
      connect(options: {
        model: string;
        config: Record<string, unknown>;
        callbacks: {
          onopen?(): void;
          onmessage?(message: any): void;
          onerror?(error: any): void;
          onclose?(event: any): void;
        };
      }): Promise<{
        sendRealtimeInput(input: any): void;
        sendClientContent(input: any): void;
        sendToolResponse(input: any): void;
        close(): void;
      }>;
    };
  }
}
