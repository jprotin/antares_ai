// Carte d'idée pour Antares : titre, effort en mots, bénéfice, première étape,
// « Inspirée de » (lien) ; « Intéressé » (ouvre le prompt) et « Pas intéressé » (carte
// repliée, « Annuler »). Passage ancien (sans identifiant) : pas de vote.
import { FileText, ThumbsDown, ThumbsUp, Undo2 } from "lucide-react";

import type { VeilleIdea, VeilleVoteValue } from "@/types/api";

import { safeHref } from "./veille";

const EFFORT: Record<VeilleIdea["effort"], string> = {
  S: "Effort faible",
  M: "Effort moyen",
  L: "Effort important",
};

export function IdeaCard({
  idea,
  vote,
  onVote,
  onShowPrompt,
}: {
  idea: VeilleIdea;
  vote: VeilleVoteValue | null;
  onVote: (value: VeilleVoteValue) => void;
  onShowPrompt: () => void;
}) {
  const inspiration = idea.inspired_by;
  const href = inspiration ? safeHref(inspiration.url) : null;

  if (vote === "dislike") {
    return (
      <li
        className="veille-idea veille-idea--folded"
        data-vote="dislike"
        data-testid="veille-idea"
      >
        <h4 className="veille-idea__title">{idea.title}</h4>
        <span className="veille-muted veille-idea__note">Pas intéressé</span>
        <button
          type="button"
          className="veille-pill veille-pill--quiet"
          aria-label={`Annuler « pas intéressé » pour ${idea.title}`}
          onClick={() => onVote("dislike")}
        >
          <Undo2 aria-hidden="true" />
          Annuler
        </button>
      </li>
    );
  }

  return (
    <li
      className="veille-idea"
      data-vote={vote ?? undefined}
      data-testid="veille-idea"
    >
      <div className="veille-idea__head">
        <span className="veille-tag" data-effort={idea.effort}>
          {EFFORT[idea.effort]}
        </span>
      </div>
      <h4 className="veille-idea__title">{idea.title}</h4>
      {idea.benefit && <p className="veille-idea__benefit">{idea.benefit}</p>}
      {idea.first_step && (
        <p className="veille-idea__step">
          <span className="veille-idea__step-label">Première étape</span>
          {idea.first_step}
        </p>
      )}
      {inspiration && (
        <p className="veille-idea__source">
          Inspirée de{" "}
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {inspiration.title}
            </a>
          ) : (
            <span>{inspiration.title}</span>
          )}
        </p>
      )}
      {idea.id && (
        <div className="veille-idea__actions">
          <button
            type="button"
            className="veille-pill veille-pill--interest"
            aria-pressed={vote === "like"}
            aria-label={`Intéressé : ${idea.title}`}
            onClick={() => onVote("like")}
          >
            <ThumbsUp aria-hidden="true" />
            Intéressé
          </button>
          <button
            type="button"
            className="veille-pill"
            aria-pressed={false}
            aria-label={`Pas intéressé : ${idea.title}`}
            onClick={() => onVote("dislike")}
          >
            <ThumbsDown aria-hidden="true" />
            Pas intéressé
          </button>
          {vote === "like" && (
            <button
              type="button"
              className="veille-pill veille-pill--primary"
              aria-label={`Voir le prompt : ${idea.title}`}
              onClick={onShowPrompt}
            >
              <FileText aria-hidden="true" />
              Voir le prompt
            </button>
          )}
        </div>
      )}
    </li>
  );
}
