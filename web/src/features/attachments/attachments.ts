// Documents joints à la conversation (port de attachments.js) : le texte est extrait et
// gardé par le routeur (documents.py), qui l'ajoute à chaque question.
import { createStore } from "zustand/vanilla";

import { store } from "@/state/store";
import type { AttachedDocument } from "@/types/api";

export const ACCEPT =
  ".pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.log,.json,.yaml,.yml,.xml,.html,.ini," +
  ".conf,.cfg,.toml,.py,.js,.ts,.sh,.sql,.php,.go,.rs,.java,.tf,.properties," +
  ".png,.jpg,.jpeg,.webp";

export const KIND_LABELS: Record<string, string> = {
  pdf: "PDF",
  word: "Word",
  texte: "Texte",
  image: "Image",
};

export function tokenSize(tokens: number): string {
  return tokens >= 1000
    ? `~${Math.round(tokens / 1000)} k tokens`
    : `~${tokens} tokens`;
}

type Pending = { key: number; name: string };

type AttachmentsState = { documents: AttachedDocument[]; pending: Pending[] };

export const attachments = createStore<AttachmentsState>()(() => ({
  documents: [],
  pending: [],
}));

let pendingKey = 0;

function notify(text: string, doc: AttachedDocument | null) {
  const { systemLine } = store.getState();
  if (doc)
    systemLine(
      `${text}${doc.voice ? "" : " — trop long pour l'oral, utilisé à l'écrit"}`,
    );
  else systemLine(text, true);
}

async function upload(file: File) {
  const pending = { key: (pendingKey += 1), name: file.name };
  attachments.setState((s) => ({ pending: [...s.pending, pending] }));
  const done = () =>
    attachments.setState((s) => ({
      pending: s.pending.filter((p) => p !== pending),
    }));
  try {
    const response = await fetch("api/documents", {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-Filename": encodeURIComponent(file.name),
      },
      body: file,
    });
    const body = (await response.json().catch(() => ({}))) as
      AttachedDocument | { detail?: string };
    if (!response.ok) {
      throw new Error(
        ("detail" in body && body.detail) ||
          (response.status === 413
            ? `${file.name} : fichier trop volumineux (15 Mo au maximum)`
            : `${file.name} : envoi impossible (HTTP ${response.status})`),
      );
    }
    done();
    attachments.setState((s) => ({
      documents: [...s.documents, body as AttachedDocument],
    }));
    notify(`Document joint : ${file.name}`, body as AttachedDocument);
  } catch (error) {
    done();
    notify((error as Error).message, null);
  }
}

export async function uploadAll(files: File[]) {
  for (const file of files) await upload(file);
}

export async function removeDocument(id: string) {
  await fetch(`api/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
  attachments.setState((s) => ({
    documents: s.documents.filter((doc) => doc.id !== id),
  }));
}

export async function loadDocuments() {
  const response = await fetch("api/documents", { cache: "no-store" });
  const documents = response.ok
    ? ((await response.json()) as AttachedDocument[])
    : [];
  attachments.setState({ documents });
}

export async function clearDocuments() {
  await fetch("api/documents", { method: "DELETE" });
  attachments.setState({ documents: [] });
}
