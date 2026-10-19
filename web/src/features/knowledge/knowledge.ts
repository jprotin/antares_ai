// Fiches de connaissance (port de knowledge.js) : le LLM rédige une fiche depuis la
// conversation ou un document joint ; l'utilisateur la relit, choisit les fiches qu'elle
// remplace, puis l'indexe dans le RAG. La rédaction est lancée hors de React (une seule
// requête, même sous StrictMode) ; la fenêtre affiche l'état de ce petit store.
import { createStore } from "zustand/vanilla";

import { getJson, sendJson } from "@/lib/api";
import { recentHistory } from "@/state/slices/conversation";
import { store } from "@/state/store";

export type Card = {
  id?: string;
  title: string;
  body: string;
  tags?: string[];
  valid_until?: string | null;
  project: string;
  source?: { name: string };
  [key: string]: unknown;
};

export type Similar = {
  id: string;
  title: string;
  score: number;
  created: number;
};

type Draft = { draft: Card; similar: Similar[]; cut: boolean };

export type EditorState = {
  // Numéro de la rédaction en cours (le formulaire repart de zéro à chaque fiche)
  run: number;
  phase: "drafting" | "ready" | "error";
  status: string;
  draft: Card | null;
  similar: Similar[];
};

export const editor = createStore<EditorState>()(() => ({
  run: 0,
  phase: "drafting",
  status: "",
  draft: null,
  similar: [],
}));

type Source = { messages: unknown[] } | { document_id: string };

async function open(source: Source) {
  const run = editor.getState().run + 1;
  editor.setState({
    run,
    phase: "drafting",
    status: "Rédaction de la fiche par le modèle…",
    draft: null,
    similar: [],
  });
  store.getState().showDialog("knowledge-edit");
  const project = store.getState().settings?.project ?? "";
  try {
    const result = await sendJson<Draft>("api/knowledge/draft", "POST", {
      ...source,
      project,
    });
    if (editor.getState().run !== run) return;
    editor.setState({
      phase: "ready",
      draft: result.draft,
      similar: result.similar,
      status: result.cut
        ? "Source longue : fiche rédigée à partir des 60 000 premiers caractères."
        : `Source : ${result.draft.source?.name ?? ""}. Relisez et corrigez avant d'indexer.`,
    });
  } catch (error) {
    if (editor.getState().run !== run) return;
    editor.setState({
      phase: "error",
      status: `Fiche impossible : ${(error as Error).message}`,
    });
  }
}

export function proposeFromConversation() {
  const messages = recentHistory(store.getState().messages);
  if (!messages.length) {
    store
      .getState()
      .systemLine("Rien à proposer : la conversation est vide.", true);
    return;
  }
  void open({ messages });
}

export function proposeFromDocument(documentId: string) {
  void open({ document_id: documentId });
}

// Changer de projet : les fiches proches se cherchent dans le nouveau projet
export function findSimilar(title: string, body: string, project: string) {
  return sendJson<Similar[]>("api/knowledge/similar", "POST", {
    title,
    body,
    project,
  }).catch(() => [] as Similar[]);
}

export async function projectIds(): Promise<string[]> {
  const projects = await getJson<{ id: string }[]>("api/projects").catch(
    () => [],
  );
  return projects.map((p) => p.id);
}
