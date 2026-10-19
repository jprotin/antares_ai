// Conversation unique, écrite et orale (app.js) : envoyée au routeur hors appel,
// rejouée au moteur vocal au début d'un appel, complétée pendant l'appel.
import type { StateCreator } from "zustand/vanilla";

export const HISTORY_LIMIT = 30;
// Budget en caractères : au-delà, Ollama tronquerait le début sans prévenir
export const HISTORY_CHARS = 24000;

export type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type ConversationSlice = {
  messages: Message[];
  remember(role: Message["role"], content: string | undefined): void;
};

export const createConversationSlice: StateCreator<ConversationSlice> = (
  set,
) => ({
  messages: [],
  remember: (role, content) => {
    const text = content?.trim();
    if (text)
      set((state) => ({
        messages: [...state.messages, { role, content: text }],
      }));
  },
});

// Derniers messages dans la limite du nombre et du budget (le plus récent est gardé)
export function recentHistory<T extends { content: string }>(
  messages: readonly T[],
): T[] {
  const kept: T[] = [];
  let chars = 0;
  for (const message of messages.slice(-HISTORY_LIMIT).reverse()) {
    chars += message.content.length;
    if (kept.length && chars > HISTORY_CHARS) break;
    kept.unshift(message);
  }
  return kept;
}
