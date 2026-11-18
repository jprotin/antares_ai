// Mini-fenêtre du journal (en haut à gauche de la Veille) : l'avatar en petit et le
// bouton qui lance le journal, comme un présentateur de journal télévisé. Pendant le
// journal : sujet en cours, « Sujet suivant », « Arrêter » ; le sujet présenté est
// remonté au parent (mis en évidence dans la liste). L'état vient du routeur (le
// journal peut aussi être lancé à la voix : « fais-moi le journal »).
import { Play, SkipForward, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { avatar } from "@/app/runtime";
import { failureReason } from "@/lib/api";
import { useAppStore } from "@/state/hooks";
import { currentVoice } from "@/state/slices/profile";

import {
  journalState,
  nextTopic,
  startJournal,
  stopJournal,
  type JournalState,
} from "./journal";

const POLL_MS = 1500;

function stageLabel(state: JournalState): string {
  if (state.stage === "ideas") return "Les idées du jour";
  if (state.stage === "outro") return "Fin du journal";
  if (state.stage === "ready") return "Prise d'antenne…";
  return `Sujet ${(state.index ?? 0) + 1} sur ${state.total ?? 0}`;
}

export function JournalPanel({
  available,
  onCurrent,
}: {
  // Un passage avec des articles existe
  available: boolean;
  onCurrent: (articleId: string | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const name = useAppStore((state) => currentVoice(state)?.name ?? "Antares");
  const callState = useAppStore((state) => state.callState);
  const [state, setState] = useState<JournalState>({ active: false });
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  // L'avatar quitte la scène d'appel le temps de la fenêtre, puis y revient
  useEffect(() => (host.current ? avatar.mount(host.current) : undefined), []);

  const refresh = useCallback(async () => {
    try {
      const next = await journalState();
      setState(next);
      onCurrent(next.active ? (next.current_id ?? null) : null);
    } catch {
      // Routeur momentanément injoignable : l'état reviendra au prochain relevé
    }
  }, [onCurrent]);

  useEffect(() => {
    // Premier relevé tout de suite (journal lancé à la voix), puis à intervalle
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const launch = async () => {
    setError("");
    setStarting(true);
    try {
      setState(await startJournal());
    } catch (failure) {
      setError(failureReason(failure));
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    setError("");
    try {
      await stopJournal();
    } catch (failure) {
      setError(failureReason(failure));
    }
    await refresh();
  };

  const connecting = starting || callState === "connecting";
  return (
    <section
      className="veille-journal"
      aria-label="Journal de la veille"
      data-active={state.active ? "true" : undefined}
      data-testid="veille-journal"
    >
      <div className="veille-journal__screen">
        <div ref={host} className="veille-journal__avatar" />
        {state.active && (
          <span className="veille-journal__live">En direct</span>
        )}
      </div>
      <div className="veille-journal__side">
        <p className="veille-journal__title">Le journal</p>
        <p className="veille-journal__hint" data-testid="veille-journal-status">
          {state.active
            ? stageLabel(state)
            : available
              ? `${name} vous raconte la veille et vous demande votre avis`
              : "Pas encore de veille à raconter"}
        </p>
        {state.active ? (
          <div className="veille-journal__buttons">
            <button
              type="button"
              className="veille-pill"
              disabled={state.stage === "outro"}
              onClick={nextTopic}
            >
              <SkipForward aria-hidden="true" />
              Sujet suivant
            </button>
            <button
              type="button"
              className="veille-pill"
              onClick={() => void stop()}
            >
              <Square aria-hidden="true" />
              Arrêter
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="veille-pill veille-journal__start"
            disabled={!available || connecting}
            onClick={() => void launch()}
          >
            <Play aria-hidden="true" />
            {connecting ? "Connexion…" : "Lancer le journal"}
          </button>
        )}
        {error && (
          <p className="veille-journal__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
