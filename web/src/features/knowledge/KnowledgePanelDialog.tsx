// Panneau Connaissances (port de renderCards, knowledge.js) : fiches indexées par projet,
// obsolescence et suppression (avec confirmation)
import { Dialog } from "radix-ui";
import { useCallback, useEffect, useState } from "react";

import { deleteResource, getJson, sendJson } from "@/lib/api";

import type { Card } from "./knowledge";
import "@/styles/legacy-dialogs.css";

const STATES: Record<string, string> = {
  active: "active",
  expired: "expirée",
  obsolete: "obsolète",
};

type IndexedCard = Card & {
  id: string;
  state: string;
  updated: number;
};

type Listing = { enabled: boolean; cards: IndexedCard[] };

function CardItem({
  card,
  onChanged,
  onError,
}: {
  card: IndexedCard;
  onChanged(): void;
  onError(message: string): void;
}) {
  const meta = [
    new Date(card.updated * 1000).toLocaleDateString("fr-FR"),
    card.source?.name && `source : ${card.source.name}`,
    card.valid_until && `valable jusqu'au ${card.valid_until}`,
  ].filter(Boolean);
  return (
    <article className="agent-card">
      <div className="agent-card__head">
        <span className="option__title">{card.title}</span>
        <span
          className={`badge badge--${card.state === "active" ? "gpu" : "unknown"}`}
        >
          {STATES[card.state]}
        </span>
      </div>
      <div className="agent-card__actions">
        {card.state !== "obsolete" && (
          <button
            type="button"
            className="preview-button"
            onClick={async () => {
              try {
                await sendJson(`api/knowledge/${card.id}/obsolete`, "POST");
                onChanged();
              } catch (reason) {
                onError((reason as Error).message);
              }
            }}
          >
            Obsolète
          </button>
        )}
        <button
          type="button"
          className="preview-button"
          onClick={async () => {
            if (!window.confirm(`Supprimer la fiche « ${card.title} » ?`))
              return;
            try {
              await deleteResource(`api/knowledge/${card.id}`);
              onChanged();
            } catch (reason) {
              onError((reason as Error).message);
            }
          }}
        >
          Supprimer
        </button>
      </div>
      <p className="option__detail">{meta.join(" · ")}</p>
    </article>
  );
}

export function KnowledgePanelDialog() {
  const [listing, setListing] = useState<Listing>();
  const [error, setError] = useState("");

  const load = useCallback(() => {
    getJson<Listing>("api/knowledge")
      .then((data) => {
        setListing(data);
        setError("");
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(load, [load]);

  const cards = listing?.cards ?? [];
  const projects = [...new Set(cards.map((c) => c.project))].sort();

  return (
    <div className="settings__form">
      <header className="settings__header dialog__header">
        <Dialog.Title asChild>
          <h2>Connaissances</h2>
        </Dialog.Title>
        <p>Fiches indexées dans le RAG, par projet.</p>
      </header>
      <div className="agents__list" id="knowledge-cards">
        {error && <p className="settings__error">{error}</p>}
        {listing && !listing.enabled && (
          <p className="settings__error">
            Indexation désactivée : RAG_WRITE_TOKEN absent d'ai-to-boost
            (relancer install.sh).
          </p>
        )}
        {listing && !cards.length && (
          <p className="agents__empty">
            Aucune fiche pour l'instant. Utilisez « Proposer au RAG » sur une
            conversation ou un document.
          </p>
        )}
        {projects.map((project) => (
          <section key={project || "commun"} className="agents__group">
            <h3>{project || "Commun"}</h3>
            {cards
              .filter((c) => c.project === project)
              .map((card) => (
                <CardItem
                  key={card.id}
                  card={card}
                  onChanged={load}
                  onError={setError}
                />
              ))}
          </section>
        ))}
      </div>
      <footer className="settings__actions dialog__footer">
        <Dialog.Close asChild>
          <button type="button" className="button-primary" id="knowledge-close">
            Fermer
          </button>
        </Dialog.Close>
      </footer>
    </div>
  );
}
