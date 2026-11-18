// Fenêtre du prompt d'une idée (prêt à coller dans Claude Code) : préparation (jusqu'à
// 2 minutes), erreur avec « Réessayer » (modèle illisible ou injoignable), texte en `pre`
// défilant, bouton « Copier » puis « Copié » 2 s, annonce aria-live.
import { Check, Copy, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { VeilleIdeaPrompt } from "@/types/api";

import { copyText, formatDateTime } from "./veille";

export type PromptState =
  | { status: "loading" }
  | { status: "ready"; prompt: VeilleIdeaPrompt }
  | { status: "error"; message: string; retryable: boolean };

const COPIED_MS = 2000;

export function IdeaPromptDialog({
  title,
  state,
  onClose,
  onRetry,
}: {
  title: string;
  state: PromptState;
  onClose: () => void;
  onRetry: () => void;
}) {
  const [copy, setCopy] = useState<"idle" | "copied" | "manual">("idle");
  const [announce, setAnnounce] = useState("");
  const content = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function onCopy() {
    if (state.status !== "ready") return;
    const result = await copyText(state.prompt.prompt, {
      clipboard: navigator.clipboard,
      doc: document,
      container: content.current,
    });
    window.clearTimeout(timer.current);
    if (result === "manual") {
      setCopy("manual");
      setAnnounce("Copie impossible : sélectionner le texte puis Ctrl+C");
      return;
    }
    setCopy("copied");
    setAnnounce("Prompt copié dans le presse-papiers");
    timer.current = window.setTimeout(() => {
      setCopy("idle");
      setAnnounce("");
    }, COPIED_MS);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        ref={content}
        showCloseButton={false}
        className="veille-prompt flex max-h-[min(88dvh,52rem)] flex-col gap-0 p-0 sm:max-w-3xl motion-reduce:animate-none"
        data-testid="veille-prompt"
      >
        <header className="veille-prompt__header">
          <p className="veille-prompt__kicker">Prompt pour Claude Code</p>
          <DialogTitle className="veille-prompt__title text-lg leading-snug font-bold">
            {title}
          </DialogTitle>
          <DialogDescription className="veille-prompt__desc">
            À coller dans Claude Code : contexte, objectif, fichiers, démarche,
            contraintes et critères de fin.
          </DialogDescription>
          <p
            className="veille-prompt__warning"
            data-testid="veille-prompt-warning"
          >
            Relire avant de coller : texte rédigé par un modèle à partir
            d'actualités.
          </p>
        </header>

        <div
          className="veille-prompt__body"
          aria-busy={state.status === "loading"}
        >
          {state.status === "loading" && (
            <div className="veille-prompt__loading" role="status">
              <span className="veille-spinner" aria-hidden="true" />
              <p>Préparation du prompt…</p>
              <p className="veille-muted">
                Le modèle local rédige le prompt : jusqu'à 2 minutes.
              </p>
            </div>
          )}
          {state.status === "error" && (
            <div className="veille-prompt__error" role="alert">
              <p>Prompt indisponible : {state.message}</p>
              {state.retryable && (
                <button
                  type="button"
                  className="veille-pill veille-pill--primary"
                  onClick={onRetry}
                >
                  <RotateCcw aria-hidden="true" />
                  Réessayer
                </button>
              )}
            </div>
          )}
          {state.status === "ready" && (
            <pre
              className="veille-prompt__text"
              tabIndex={0}
              aria-label="Texte du prompt"
              data-testid="veille-prompt-text"
            >
              {state.prompt.prompt}
            </pre>
          )}
        </div>

        <footer className="veille-prompt__footer">
          <p className="veille-prompt__meta">
            {state.status === "ready" &&
              [state.prompt.model, formatDateTime(state.prompt.created_at)]
                .filter(Boolean)
                .join(" · ")}
          </p>
          <p className="sr-only" aria-live="polite">
            {announce}
          </p>
          {copy === "manual" && (
            <p className="veille-prompt__manual">
              Sélectionner le texte puis Ctrl+C
            </p>
          )}
          <div className="veille-prompt__actions">
            <DialogClose asChild>
              <button type="button" className="veille-pill">
                Fermer
              </button>
            </DialogClose>
            <button
              type="button"
              className="veille-pill veille-pill--primary veille-copy"
              data-copied={copy === "copied" ? "true" : undefined}
              disabled={state.status !== "ready"}
              onClick={() => void onCopy()}
            >
              {copy === "copied" ? (
                <>
                  <Check aria-hidden="true" />
                  Copié
                </>
              ) : (
                <>
                  <Copy aria-hidden="true" />
                  Copier
                </>
              )}
            </button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
