// Lignes affichées de la conversation (sous-titres de app.js) : parole, écrit, lignes
// système. Distinctes de `messages` (mémoire envoyée au LLM).
import type { StateCreator } from "zustand/vanilla";

import type { TurnWeb } from "@/types/api";

export type LineRole = "user" | "assistant" | "system";

export type Line = {
  id: string;
  role: LineRole;
  // Nom affiché (« Vous » ou celui de la voix au moment de la ligne)
  who: string;
  text: string;
  partial: boolean;
  // Markdown rendu (réponses écrites) ; sinon texte brut
  rich: boolean;
  error: boolean;
  meta: string[];
  // Code dicté à l'oral (blocs Markdown), sources du RAG, recherche web
  code?: string;
  refs?: string[];
  web?: TurnWeb;
};

export type WriteOptions = { append?: boolean; final?: boolean; who?: string };

export type LinesSlice = {
  lines: Line[];
  writeLine(
    id: string,
    role: LineRole,
    text: string,
    options?: WriteOptions,
  ): void;
  patchLine(id: string, patch: Partial<Omit<Line, "id">>): void;
  // Annotation sous la ligne, à la suite des précédentes (« · »)
  annotate(id: string | undefined, text: string): void;
  systemLine(text: string, error?: boolean): void;
  clearLines(): void;
};

let systemCount = 0;

export const createLinesSlice: StateCreator<LinesSlice> = (set) => ({
  lines: [],
  writeLine: (id, role, text, { append = false, final = false, who } = {}) =>
    set((state) => {
      const index = state.lines.findIndex((line) => line.id === id);
      const current = state.lines[index];
      if (!current) {
        const line: Line = {
          id,
          role,
          who: who ?? (role === "user" ? "Vous" : "Antares"),
          text,
          partial: !final,
          rich: false,
          error: false,
          meta: [],
        };
        return { lines: [...state.lines, line] };
      }
      const lines = [...state.lines];
      lines[index] = {
        ...current,
        text: append ? current.text + text : text,
        partial: !final,
      };
      return { lines };
    }),
  patchLine: (id, patch) =>
    set((state) => ({
      lines: state.lines.map((line) =>
        line.id === id ? { ...line, ...patch } : line,
      ),
    })),
  annotate: (id, text) =>
    set((state) => ({
      lines: state.lines.map((line) =>
        line.id === id ? { ...line, meta: [...line.meta, text] } : line,
      ),
    })),
  systemLine: (text, error = false) =>
    set((state) => ({
      lines: [
        ...state.lines,
        {
          id: `system-${(systemCount += 1)}`,
          role: "system",
          who: "",
          text,
          partial: false,
          rich: false,
          error,
          meta: [],
        },
      ],
    })),
  clearLines: () => set({ lines: [] }),
});
