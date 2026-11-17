// Veille IA et météo : dernier passage relevé (interrogation périodique) et date de
// dernière ouverture de la fenêtre (stockage du navigateur, sous try/catch)
import { createStore } from "zustand/vanilla";

import { getJson } from "@/lib/api";
import { readPreference, STORAGE_KEYS, writePreference } from "@/lib/storage";
import type { VeilleLatest } from "@/types/api";

import { openedStamp, parseLatest, parseStamp } from "./veille";

// Interrogation de api/veille/latest : au montage du bouton puis toutes les 5 minutes
export const POLL_MS = 5 * 60_000;

type VeilleState = {
  latest: VeilleLatest | null;
  lastOpened: string | null;
};

function storedOpened(): string | null {
  const value = readPreference(STORAGE_KEYS.veilleLastOpened);
  // Valeur corrompue : comme absente (la pastille reste allumée jusqu'à l'ouverture)
  return parseStamp(value) === null ? null : value;
}

export const veilleStore = createStore<VeilleState>()(() => ({
  latest: null,
  lastOpened: storedOpened(),
}));

// Relevé du dernier passage ; 403 (partage), 404, réseau ou forme inattendue : ignorés
export async function refreshLatest(): Promise<VeilleLatest | null> {
  let latest: VeilleLatest | null;
  try {
    latest = parseLatest(await getJson("api/veille/latest"));
  } catch {
    return null;
  }
  if (latest) veilleStore.setState({ latest });
  return latest;
}

export function startPolling(): () => void {
  void refreshLatest();
  const timer = window.setInterval(() => void refreshLatest(), POLL_MS);
  return () => window.clearInterval(timer);
}

// Ouverture et fermeture de la fenêtre : la pastille s'éteint
export function markOpened(): void {
  const latestAt = veilleStore.getState().latest?.run?.finished_at;
  const lastOpened = openedStamp(new Date(), latestAt);
  writePreference(STORAGE_KEYS.veilleLastOpened, lastOpened);
  veilleStore.setState({ lastOpened });
}
