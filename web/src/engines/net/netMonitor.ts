// Connexion Internet et partage ngrok (port de web.js) : relevé de api/net toutes les
// 15 s ; les bascules (pas le premier relevé) produisent une ligne système.
import { getJson } from "@/lib/api";
import type { NetState } from "@/types/api";

const POLL_MS = 15000;
const SEARCH_POLL_MS = 600;

export type NetCallbacks = {
  onState(state: NetState): void;
  onChange(online: boolean): void;
  onSharing(sharing: boolean): void;
};

export function netLabel(state: NetState): string {
  if (!state.online) return "Hors ligne";
  return state.sharing ? "Internet · partagé" : "Internet";
}

export function netTitle(state: NetState): string {
  let title = state.online
    ? `Connecté à Internet : recherche web ${state.search ? "disponible" : "indisponible (SearXNG ne répond pas)"}, modèles Claude disponibles`
    : "Pas de connexion à Internet : pas de recherche web, modèles locaux seulement";
  if (state.sharing)
    title +=
      " — Partage ngrok en cours : Claude et l'écriture dans le RAG sont désactivés";
  return title;
}

export function startNetMonitor({
  onState,
  onChange,
  onSharing,
}: NetCallbacks): () => void {
  let online: boolean | null = null;
  let sharing: boolean | null = null;
  async function poll() {
    let state: NetState;
    try {
      state = await getJson<NetState>("api/net");
    } catch {
      return;
    }
    const changed = state.online !== online;
    const sharingChanged = Boolean(state.sharing) !== sharing;
    online = state.online;
    onState(state);
    if (changed && sharing !== null) onChange(state.online);
    if (sharingChanged && sharing !== null) onSharing(Boolean(state.sharing));
    sharing = Boolean(state.sharing);
  }
  void poll();
  const timer = window.setInterval(poll, POLL_MS);
  return () => window.clearInterval(timer);
}

// Pendant la réflexion : signale une recherche web en cours ; renvoie l'arrêt
export function watchSearch(onSearching: (searching: boolean) => void) {
  let active = true;
  let shown = false;
  void (async () => {
    while (active) {
      try {
        const { searching } = await getJson<NetState>("api/net");
        if (Boolean(searching) !== shown && active) {
          shown = Boolean(searching);
          onSearching(shown);
        }
      } catch {
        return;
      }
      await new Promise((resolve) =>
        window.setTimeout(resolve, SEARCH_POLL_MS),
      );
    }
  })();
  return () => {
    active = false;
  };
}
