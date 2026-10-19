// États discrets de l'appel (data-state sur la racine) ; les données à haute fréquence
// (niveaux audio, file de lecture) restent dans les moteurs, hors de l'état React.
import type { StateCreator } from "zustand/vanilla";

export type CallState =
  "idle" | "connecting" | "listening" | "user" | "thinking" | "speaking";

export type CallSlice = {
  callState: CallState;
  status: string;
  setCallState(state: CallState, status?: string): void;
  setStatus(status: string): void;
};

// Libellés de app.js (STATUS_TEXT), repris tels quels
export const STATUS_TEXT: Record<CallState, string> = {
  idle: "Disponible pour un appel",
  connecting: "Connexion…",
  listening: "Je vous écoute",
  user: "Vous parlez…",
  thinking: "Je réfléchis…",
  speaking: "Je vous réponds",
};

export const createCallSlice: StateCreator<CallSlice> = (set) => ({
  callState: "idle",
  status: STATUS_TEXT.idle,
  setCallState: (callState, status) =>
    set({ callState, status: status ?? STATUS_TEXT[callState] }),
  setStatus: (status) => set({ status }),
});
