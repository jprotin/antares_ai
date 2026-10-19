// Protocole realtime (compatible OpenAI) du moteur s2s : événements envoyés par
// l'interface, tels que app.js les construit.

export const SAMPLE_RATE = 24000;
// Écho de la fin d'une réponse, encore capté par le micro après la lecture
export const ECHO_TAIL_MS = 300;
// Seuil de détection de parole du moteur (son défaut), relevé pendant une répétition
export const DEFAULT_VAD_THRESHOLD = 0.6;

export function realtimeUrl(location: Location = window.location): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/v1/realtime`;
}

export type ServerEvent = { type: string; [key: string]: unknown };

export function sessionUpdate({
  instructions,
  voice,
  vadThreshold,
}: {
  instructions?: string;
  voice?: string;
  vadThreshold: number;
}) {
  return {
    type: "session.update",
    session: {
      type: "realtime",
      instructions,
      audio: {
        input: {
          format: { type: "audio/pcm", rate: SAMPLE_RATE },
          turn_detection: {
            type: "server_vad",
            interrupt_response: true,
            threshold: vadThreshold,
          },
        },
        output: {
          format: { type: "audio/pcm", rate: SAMPLE_RATE },
          ...(voice ? { voice } : {}),
        },
      },
    },
  };
}

export function messageItem(
  id: string,
  role: "user" | "assistant" | "system",
  text: string,
) {
  return {
    type: "conversation.item.create",
    item: {
      id,
      type: "message",
      role,
      content: [{ type: role === "user" ? "input_text" : "output_text", text }],
    },
  };
}

export const appendAudio = (audio: string) => ({
  type: "input_audio_buffer.append",
  audio,
});

export const responseCreate = () => ({ type: "response.create" });
