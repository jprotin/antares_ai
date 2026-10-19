// WebSocket realtime simulé (page.routeWebSocket) : rend déterministes les états de
// l'appel, l'interruption et les pannes, sans pile s2s ni GPU.
import type { Page, WebSocketRoute } from "@playwright/test";

export type ServerEvent = Record<string, unknown> & { type: string };

// 20 ms de PCM16 24 kHz (silence) : 960 octets, 1 280 caractères base64
export const SILENT_DELTA = Buffer.alloc(960).toString("base64");

export class RealtimeMock {
  socket?: WebSocketRoute;
  readonly received: ServerEvent[] = [];
  private connected?: () => void;
  private readonly ready = new Promise<void>(
    (resolve) => (this.connected = resolve),
  );

  constructor(private readonly page: Page) {}

  async install() {
    await this.page.routeWebSocket("**/v1/realtime", (ws) => {
      this.socket = ws;
      ws.onMessage((message) => {
        const event = JSON.parse(String(message)) as ServerEvent;
        this.received.push(event);
        if (event.type === "session.update")
          this.send({ type: "session.updated", session: {} });
      });
      this.connected?.();
    });
    return this;
  }

  async connectedSocket() {
    await this.ready;
    return this.socket as WebSocketRoute;
  }

  send(event: ServerEvent) {
    this.socket?.send(JSON.stringify(event));
  }

  // Tour complet : l'utilisateur parle, l'assistant répond (texte et audio)
  async turn(reply: string, { audioChunks = 5 } = {}) {
    await this.connectedSocket();
    this.send({
      type: "input_audio_buffer.speech_started",
      item_id: "item_user",
    });
    this.send({
      type: "input_audio_buffer.speech_stopped",
      item_id: "item_user",
    });
    this.send({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_user",
      transcript: "Quelle est la capitale de la France ?",
    });
    this.send({ type: "response.created", response: { id: "resp_1" } });
    this.send({
      type: "response.output_audio_transcript.delta",
      item_id: "item_assistant",
      delta: reply,
    });
    for (let i = 0; i < audioChunks; i += 1) {
      this.send({
        type: "response.output_audio.delta",
        item_id: "item_assistant",
        delta: SILENT_DELTA,
      });
    }
    this.send({
      type: "response.output_audio_transcript.done",
      item_id: "item_assistant",
      transcript: reply,
    });
    this.send({
      type: "response.done",
      response: { id: "resp_1", status: "completed" },
    });
  }

  close(code = 1000, reason = "") {
    return this.socket?.close({ code, reason });
  }
}
