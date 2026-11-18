// Fiche d'un article (à la une ou non retenu) : catégorie, langue, source et date,
// titre d'origine, phrase en français du modèle, extrait publié par le site (texte
// React, jamais du HTML), j'aime / je n'aime pas, étoile « Privilégier cette source »,
// lien vers l'article original (http(s) seulement, nouvel onglet). Article en anglais :
// « Traduire en français » traduit le titre et l'extrait par le modèle (une fois, gardé
// par le routeur), puis « Voir l'original » / « Voir la traduction ».
import {
  ExternalLink,
  Languages,
  Star,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  VeilleItem,
  VeilleTranslation,
  VeilleVoteValue,
} from "@/types/api";

import { translateArticle } from "./api";
import { categoryColor, formatDateTime, safeHref } from "./veille";

type Translation =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; value: VeilleTranslation; shown: boolean }
  | { status: "error"; message: string };

export function ArticleDialog({
  item,
  categoryLabel,
  vote,
  favorite,
  onVote,
  onFavorite,
  onClose,
  readOnly = false,
}: {
  item: VeilleItem;
  categoryLabel: string;
  vote: VeilleVoteValue | null;
  // null : sources privilégiées indisponibles (étoile masquée)
  favorite: boolean | null;
  onVote: (value: VeilleVoteValue) => void;
  onFavorite: () => void;
  onClose: () => void;
  // Invité d'un partage : ni vote ni étoile ; traduction déjà faite seulement
  readOnly?: boolean;
}) {
  const href = safeHref(item.url);
  const when = item.published_at ? formatDateTime(item.published_at) : "";
  const [translation, setTranslation] = useState<Translation>({
    status: "idle",
  });
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const canTranslate = item.lang === "en" && Boolean(item.id);
  const translated =
    translation.status === "ready" && translation.shown
      ? translation.value
      : null;
  const title = translated?.title ?? item.title;
  const summary = translated ? translated.summary : item.summary;

  async function onTranslate() {
    if (translation.status === "ready") {
      setTranslation({ ...translation, shown: !translation.shown });
      return;
    }
    if (!item.id || translation.status === "loading") return;
    setTranslation({ status: "loading" });
    try {
      const value = await translateArticle(item.id);
      if (mounted.current)
        setTranslation({ status: "ready", value, shown: true });
    } catch (error) {
      if (mounted.current)
        setTranslation({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="veille-prompt veille-article flex max-h-[min(88dvh,46rem)] flex-col gap-0 p-0 sm:max-w-2xl motion-reduce:animate-none"
        data-cat={categoryColor(item.category)}
        data-testid="veille-article-dialog"
      >
        <header className="veille-prompt__header">
          <p className="veille-article__meta">
            <span className="veille-card__cat">
              <span className="veille-card__dot" aria-hidden="true" />
              {categoryLabel}
            </span>
            {item.lang && (
              <span className="veille-tag">{item.lang.toUpperCase()}</span>
            )}
            {canTranslate && (
              <button
                type="button"
                className="veille-pill veille-pill--quiet veille-translate"
                aria-busy={translation.status === "loading"}
                disabled={translation.status === "loading"}
                onClick={() => void onTranslate()}
              >
                {translation.status === "loading" ? (
                  <span
                    className="veille-spinner veille-spinner--small"
                    aria-hidden="true"
                  />
                ) : (
                  <Languages aria-hidden="true" />
                )}
                {translation.status === "loading"
                  ? "Traduction…"
                  : translation.status === "ready"
                    ? translation.shown
                      ? "Voir l'original"
                      : "Voir la traduction"
                    : "Traduire en français"}
              </button>
            )}
          </p>
          <DialogTitle className="veille-prompt__title text-lg leading-snug font-bold">
            {title}
          </DialogTitle>
          <DialogDescription className="veille-prompt__desc">
            {[item.source, when].filter(Boolean).join(" · ")}
          </DialogDescription>
          <p className="sr-only" aria-live="polite">
            {translation.status === "loading"
              ? "Traduction en cours"
              : translated
                ? "Article traduit en français"
                : ""}
          </p>
          {translated && (
            <p className="veille-article__note" data-testid="veille-translated">
              Traduit en français par {translated.model} : relire en cas de
              doute.
            </p>
          )}
          {translation.status === "error" && (
            <p className="veille-article__error" role="alert">
              Traduction impossible : {translation.message}
            </p>
          )}
        </header>

        <div className="veille-article__body">
          {item.sentence && (
            <section aria-labelledby="veille-article-sentence">
              <h3
                id="veille-article-sentence"
                className="veille-article__label"
              >
                En bref
              </h3>
              <p className="veille-article__sentence">{item.sentence}</p>
            </section>
          )}
          <section aria-labelledby="veille-article-extract">
            <h3 id="veille-article-extract" className="veille-article__label">
              Extrait du site
            </h3>
            {summary ? (
              <p className="veille-article__extract">{summary}</p>
            ) : (
              <p className="veille-muted">
                Pas d'extrait fourni par le site pour cet article.
              </p>
            )}
          </section>
        </div>

        <footer className="veille-prompt__footer veille-article__footer">
          {item.id && !readOnly && (
            <div className="veille-votes">
              <button
                type="button"
                className="veille-vote veille-vote--like"
                aria-pressed={vote === "like"}
                aria-label="J'aime"
                title="J'aime"
                onClick={() => onVote("like")}
              >
                <ThumbsUp aria-hidden="true" />
              </button>
              <button
                type="button"
                className="veille-vote veille-vote--dislike"
                aria-pressed={vote === "dislike"}
                aria-label="Je n'aime pas"
                title="Je n'aime pas"
                onClick={() => onVote("dislike")}
              >
                <ThumbsDown aria-hidden="true" />
              </button>
            </div>
          )}
          {favorite !== null && !readOnly && item.source && (
            <button
              type="button"
              className="veille-pill veille-star"
              aria-pressed={favorite}
              onClick={onFavorite}
            >
              <Star aria-hidden="true" />
              {favorite ? "Source privilégiée" : "Privilégier cette source"}
            </button>
          )}
          <div className="veille-prompt__actions">
            <DialogClose asChild>
              <button type="button" className="veille-pill">
                Fermer
              </button>
            </DialogClose>
            {href && (
              <a
                className="veille-pill veille-pill--primary"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink aria-hidden="true" />
                Lire l'article original
              </a>
            )}
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
