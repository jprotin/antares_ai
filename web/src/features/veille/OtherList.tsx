// Onglet « Tous les articles » : articles lus mais non retenus par le modèle, en liste
// compacte (titre, extrait sur deux lignes en petit, source · catégorie · heure,
// j'aime / je n'aime pas). Un clic sur la ligne ouvre la fiche de l'article. Tri par
// pertinence (votes) ou par date ; 50 lignes puis « Afficher 50 de plus ».
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";

import type { VeilleCategory, VeilleOther, VeilleVoteValue } from "@/types/api";

import {
  categoryColor,
  categoryLabel,
  OTHERS_PAGE,
  type OtherOrder,
  relativeTime,
} from "./veille";

export function OtherList({
  items,
  categories,
  order,
  now,
  voteOf,
  onOrder,
  onVote,
  onOpen,
  readOnly = false,
}: {
  items: readonly VeilleOther[];
  categories: readonly VeilleCategory[];
  order: OtherOrder;
  now: Date;
  voteOf: (item: VeilleOther) => VeilleVoteValue | null;
  onOrder: (order: OtherOrder) => void;
  onVote: (item: VeilleOther, value: VeilleVoteValue) => void;
  onOpen: (item: VeilleOther) => void;
  // Invité d'un partage : pas de vote
  readOnly?: boolean;
}) {
  const [limit, setLimit] = useState(OTHERS_PAGE);
  const shown = items.slice(0, limit);
  const rest = items.length - shown.length;
  return (
    <div className="veille-others">
      <div className="veille-others__bar">
        <label className="veille-others__order">
          <span>Trier par</span>
          <select
            className="veille-select"
            value={order}
            onChange={(event) => {
              onOrder(event.target.value === "date" ? "date" : "score");
              setLimit(OTHERS_PAGE);
            }}
          >
            <option value="score">Pertinence</option>
            <option value="date">Date</option>
          </select>
        </label>
      </div>
      <ul className="veille-others__list" data-testid="veille-others">
        {shown.map((item) => {
          const vote = voteOf(item);
          const when = relativeTime(item.published_at, now);
          return (
            <li
              key={item.id}
              className="veille-other"
              data-cat={categoryColor(item.category)}
              data-vote={vote ?? undefined}
              data-testid="veille-other"
            >
              <button
                type="button"
                className="veille-other__open"
                onClick={() => onOpen(item)}
              >
                <span className="veille-other__title">{item.title}</span>
                {item.summary && (
                  <span className="veille-other__summary">{item.summary}</span>
                )}
                <span className="veille-other__meta">
                  <span className="veille-other__source">{item.source}</span>
                  <span aria-hidden="true">·</span>
                  <span className="veille-other__cat">
                    {categoryLabel(item.category, categories)}
                  </span>
                  {when && (
                    <>
                      <span aria-hidden="true">·</span>
                      <time dateTime={item.published_at ?? undefined}>
                        {when}
                      </time>
                    </>
                  )}
                </span>
              </button>
              {!readOnly && (
                <div className="veille-votes veille-other__votes">
                  <button
                    type="button"
                    className="veille-vote veille-vote--like"
                    aria-pressed={vote === "like"}
                    aria-label={`J'aime : ${item.title}`}
                    title="J'aime"
                    onClick={() => onVote(item, "like")}
                  >
                    <ThumbsUp aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="veille-vote veille-vote--dislike"
                    aria-pressed={vote === "dislike"}
                    aria-label={`Je n'aime pas : ${item.title}`}
                    title="Je n'aime pas"
                    onClick={() => onVote(item, "dislike")}
                  >
                    <ThumbsDown aria-hidden="true" />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {rest > 0 && (
        <button
          type="button"
          className="veille-pill veille-others__more"
          onClick={() => setLimit(limit + OTHERS_PAGE)}
        >
          Afficher {Math.min(rest, OTHERS_PAGE)} de plus ({rest} restant
          {rest > 1 ? "s" : ""})
        </button>
      )}
    </div>
  );
}
