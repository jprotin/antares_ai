// Bouton de la barre : ouvre la Veille IA et météo ; pastille quand un passage est plus
// récent que la dernière ouverture. Présent aussi pendant un partage public (la veille y
// est en lecture seule pour les invités, cf. router/veille_access.py) ; l'interrogation
// attend le premier relevé du réseau.
import { useEffect } from "react";
import { useStore } from "zustand";

import { useAppStore } from "@/state/hooks";
import { store } from "@/state/store";

import { startPolling, veilleStore } from "./state";
import { hasNews, VEILLE_LABEL } from "./veille";

export function VeilleButton() {
  const netKnown = useAppStore((state) => state.net !== null);
  const latestAt = useStore(veilleStore, (s) => s.latest?.run?.finished_at);
  const lastOpened = useStore(veilleStore, (s) => s.lastOpened);

  useEffect(() => {
    if (!netKnown) return;
    return startPolling();
  }, [netKnown]);

  const fresh = hasNews(latestAt, lastOpened);
  const label = fresh
    ? `${VEILLE_LABEL} (nouvelle veille disponible)`
    : VEILLE_LABEL;
  return (
    <button
      type="button"
      className="settings-button veille-button"
      id="open-veille"
      aria-label={label}
      title={label}
      data-fresh={fresh ? "true" : undefined}
      onClick={() => store.getState().showDialog("veille")}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        <path d="M4 4h13a1 1 0 0 1 1 1v2h2a1 1 0 0 1 1 1v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V5a1 1 0 0 1 1-1Zm1 2v12a1 1 0 0 0 1 1h10.2a3 3 0 0 1-.2-1V6H5Zm13 3v9a1 1 0 0 0 2 0V9h-2ZM7 8h7v4H7V8Zm0 6h7v1.5H7V14Zm0 2.5h5V18H7v-1.5Z" />
      </svg>
      {fresh && <span className="veille-badge" aria-hidden="true" />}
    </button>
  );
}
