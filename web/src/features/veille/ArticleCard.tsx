// Carte d'article : liseré et puce de la catégorie, pastille de la source, langue,
// badge « Nouveau », titre d'origine (ouvre la fiche de l'article, avec le lien vers
// l'original), phrase en français (à défaut, extrait du site sur trois lignes), heure
// relative, j'aime / je n'aime pas. Carte rejetée : atténuée, avec
// « Annuler ». Passage ancien (sans identifiant) : pas de vote.
import { ThumbsDown, ThumbsUp, Undo2 } from "lucide-react";

import type { VeilleItem, VeilleVoteValue } from "@/types/api";

import { categoryColor, relativeTime, sourceInitials } from "./veille";

export function ArticleCard({
  item,
  categoryLabel,
  vote,
  isNew,
  now,
  onVote,
  onOpen,
  readOnly = false,
}: {
  item: VeilleItem;
  categoryLabel: string;
  vote: VeilleVoteValue | null;
  isNew: boolean;
  now: Date;
  onVote: (value: VeilleVoteValue) => void;
  onOpen: () => void;
  // Invité d'un partage : pas de vote
  readOnly?: boolean;
}) {
  const when = relativeTime(item.published_at, now);
  const rejected = vote === "dislike";
  return (
    <li
      className="veille-card"
      data-cat={categoryColor(item.category)}
      data-vote={vote ?? undefined}
      data-testid="veille-article"
    >
      <div className="veille-card__meta">
        <span className="veille-card__cat">
          <span className="veille-card__dot" aria-hidden="true" />
          {categoryLabel}
        </span>
        {item.lang && (
          <span
            className="veille-tag"
            title={
              item.lang === "fr" ? "Article en français" : "Article en anglais"
            }
          >
            {item.lang.toUpperCase()}
          </span>
        )}
        {isNew && <span className="veille-tag veille-tag--new">Nouveau</span>}
      </div>
      <h4 className="veille-card__title">
        <button type="button" className="veille-card__open" onClick={onOpen}>
          {item.title}
        </button>
      </h4>
      {!rejected &&
        (item.sentence ? (
          <p className="veille-card__sentence">{item.sentence}</p>
        ) : (
          // Article ajouté pour une source privilégiée : extrait du site, sans phrase
          item.summary && (
            <p className="veille-card__sentence veille-card__extract">
              {item.summary}
            </p>
          )
        ))}
      <div className="veille-card__foot">
        <span className="veille-source">
          <span className="veille-source__badge" aria-hidden="true">
            {sourceInitials(item.source)}
          </span>
          <span className="veille-source__name">{item.source}</span>
          {when && (
            <>
              <span aria-hidden="true">·</span>
              <time dateTime={item.published_at ?? undefined}>{when}</time>
            </>
          )}
        </span>
        {item.id &&
          !readOnly &&
          (rejected ? (
            <button
              type="button"
              className="veille-pill veille-pill--quiet"
              aria-label={`Annuler « je n'aime pas » pour ${item.title}`}
              onClick={() => onVote("dislike")}
            >
              <Undo2 aria-hidden="true" />
              Annuler
            </button>
          ) : (
            <div className="veille-votes">
              <button
                type="button"
                className="veille-vote veille-vote--like"
                aria-pressed={vote === "like"}
                aria-label={`J'aime : ${item.title}`}
                title="J'aime"
                onClick={() => onVote("like")}
              >
                <ThumbsUp aria-hidden="true" />
              </button>
              <button
                type="button"
                className="veille-vote veille-vote--dislike"
                aria-pressed={false}
                aria-label={`Je n'aime pas : ${item.title}`}
                title="Je n'aime pas"
                onClick={() => onVote("dislike")}
              >
                <ThumbsDown aria-hidden="true" />
              </button>
            </div>
          ))}
      </div>
    </li>
  );
}
