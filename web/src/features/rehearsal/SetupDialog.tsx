// Préparation d'une répétition et historique (port de openSetup / create / renderHistory,
// rehearsal.js). Les champs gardent leur valeur d'une ouverture à l'autre, comme le
// <dialog> de l'ancienne interface.
import { Dialog } from "radix-ui";
import { useState, type FormEvent } from "react";
import { useStore } from "zustand";

import { useAppStore } from "@/state/hooks";
import { store } from "@/state/store";

import { rehearsal } from "./instance";
import { longClock } from "./rehearsalMachine";
import type { HistoryItem } from "./types";
import "@/styles/legacy-dialogs.css";

type Draft = {
  title: string;
  pdf: File | null;
  audience: string;
  questions: string;
  goal: string;
  target: string;
};

// Brouillon conservé entre deux ouvertures de la fenêtre
let saved: Draft = {
  title: "",
  pdf: null,
  audience: "",
  questions: "3",
  goal: "",
  target: "",
};

// Notes successives d'une même présentation (même titre), de la plus ancienne
function progression(history: HistoryItem[], title: string): number[] {
  return history
    .filter((r) => r.title === title && r.score !== null)
    .reverse()
    .map((r) => r.score as number);
}

function Sparkline({ scores }: { scores: number[] }) {
  const step = scores.length > 1 ? 56 / (scores.length - 1) : 0;
  const points = scores.map(
    (s, i) => [2 + i * step, 18 - (s / 20) * 16] as const,
  );
  const last = points.at(-1) ?? [0, 0];
  return (
    <svg viewBox="0 0 60 20" className="sparkline" aria-hidden="true">
      <polyline points={points.map((p) => p.join(",")).join(" ")} />
      <circle cx={last[0]} cy={last[1]} r="2" />
    </svg>
  );
}

function History({ history }: { history: HistoryItem[] }) {
  if (!history.length)
    return <p className="agents__empty">Aucune répétition pour l'instant.</p>;
  return (
    <>
      {history.map((item) => {
        const scores = progression(history, item.title);
        const first = item === history.find((h) => h.title === item.title);
        const date = new Date(item.created * 1000).toLocaleString("fr-FR", {
          dateStyle: "medium",
          timeStyle: "short",
        });
        return (
          <article key={item.id} className="agent-card">
            <div className="agent-card__head">
              <span className="option__title">{item.title}</span>
              {item.score !== null && (
                <span className="badge badge--gpu">{`${item.score}/20`}</span>
              )}
              {scores.length > 1 && first && (
                <>
                  <Sparkline scores={scores} />
                  <span className="option__detail">{scores.join(" → ")}</span>
                </>
              )}
            </div>
            <p className="option__detail">
              {[
                date,
                item.audience_name,
                `${item.slides} slides`,
                item.duration ? longClock(item.duration) : "discours non fait",
              ].join(" · ")}
            </p>
            <div className="agent-card__actions">
              {item.score !== null && (
                <button
                  type="button"
                  className="preview-button"
                  onClick={() => void rehearsal.showSaved(item.id)}
                >
                  Rapport
                </button>
              )}
              <button
                type="button"
                className="preview-button"
                onClick={() => void rehearsal.removeSaved(item)}
              >
                Supprimer
              </button>
            </div>
          </article>
        );
      })}
    </>
  );
}

export function SetupDialog() {
  const { audiences, history, error, starting } = useStore(
    rehearsal.view,
    (state) => state.setup,
  );
  const agents = useAppStore((state) => state.agents);
  const [draft, setDraftState] = useState<Draft>(saved);
  const setDraft = (update: Partial<Draft>) =>
    setDraftState((current) => (saved = { ...current, ...update }));
  const mine = [...agents].sort((a, b) => a.name.localeCompare(b.name));
  // Sans choix, le premier public de la liste (comme un <select> sans sélection)
  const audience =
    draft.audience ||
    (audiences[0]
      ? `audience:${audiences[0].id}`
      : mine[0]
        ? `agent:${mine[0].id}`
        : "");

  function submit(event: FormEvent) {
    event.preventDefault();
    void rehearsal.create({
      title: draft.title,
      pdf: draft.pdf,
      audience,
      questions: Number(draft.questions),
      goal: draft.goal,
      target: Number(draft.target) || 0,
    });
  }

  return (
    // Identifiant et attribut open du <dialog> hérité (repères des tests et du style)
    <div id="rehearsal-setup" className="contents" {...{ open: true }}>
      <form className="settings__form" id="rehearsal-form" onSubmit={submit}>
        <header className="settings__header dialog__header">
          <Dialog.Title asChild>
            <h2>Répéter une présentation</h2>
          </Dialog.Title>
          <p>
            Déroulez votre discours en faisant défiler vos slides : l'IA écoute
            sans rien dire. Elle joue ensuite votre public pour les questions,
            puis vous présente son rapport noté.
          </p>
        </header>
        <p className="settings__error" id="rehearsal-error" role="alert">
          {error}
        </p>
        <div className="rehearsal-form">
          <label>
            Titre
            <input
              id="rehearsal-title"
              maxLength={120}
              placeholder="Soutenance migration cloud"
              required
              value={draft.title}
              onChange={(event) => setDraft({ title: event.target.value })}
            />
          </label>
          <label>
            Slides (PDF)
            <input
              type="file"
              id="rehearsal-pdf"
              accept="application/pdf,.pdf"
              required={!draft.pdf}
              onChange={(event) => {
                const pdf = event.target.files?.[0] ?? null;
                setDraft({
                  pdf,
                  ...(pdf && !draft.title.trim()
                    ? {
                        title: pdf.name
                          .replace(/\.pdf$/i, "")
                          .replace(/[_-]+/g, " "),
                      }
                    : {}),
                });
              }}
            />
          </label>
          <div className="agent-form__row">
            <label>
              Public
              <select
                id="rehearsal-audience"
                value={audience}
                onChange={(event) => setDraft({ audience: event.target.value })}
              >
                <optgroup label="Publics types">
                  {audiences.map((item) => (
                    <option key={item.id} value={`audience:${item.id}`}>
                      {item.name}
                    </option>
                  ))}
                </optgroup>
                {mine.length > 0 && (
                  <optgroup label="Mes agents">
                    {mine.map((agent) => (
                      <option key={agent.id} value={`agent:${agent.id}`}>
                        {agent.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <label>
              Questions du public
              <select
                id="rehearsal-questions"
                value={draft.questions}
                onChange={(event) =>
                  setDraft({ questions: event.target.value })
                }
              >
                {["1", "2", "3", "4", "5"].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="agent-form__row">
            <label>
              Objectif (facultatif)
              <input
                id="rehearsal-goal"
                maxLength={600}
                placeholder="Convaincre de signer le lot 2"
                value={draft.goal}
                onChange={(event) => setDraft({ goal: event.target.value })}
              />
            </label>
            <label>
              Durée visée en minutes (facultatif)
              <input
                id="rehearsal-target"
                type="number"
                min={0}
                max={240}
                value={draft.target}
                onChange={(event) => setDraft({ target: event.target.value })}
              />
            </label>
          </div>
          <p className="settings__hint">
            Exportez vos slides en PDF depuis PowerPoint, Keynote ou Google
            Slides. Pendant le discours : flèches ← → ou clic sur la slide pour
            avancer. Le rapport est rédigé par le modèle choisi dans les
            Réglages.
          </p>
        </div>
        <section
          className="rehearsal-history"
          aria-labelledby="rehearsal-history-title"
        >
          <h3 id="rehearsal-history-title">Mes répétitions</h3>
          <div className="agents__list" id="rehearsal-history">
            <History history={history} />
          </div>
        </section>
        <footer className="settings__actions dialog__footer">
          <button
            type="button"
            className="button-ghost"
            id="rehearsal-cancel"
            onClick={() => store.getState().closeDialog("rehearsal-setup")}
          >
            Fermer
          </button>
          <button
            type="submit"
            className="button-primary"
            id="rehearsal-start"
            disabled={starting}
          >
            {starting ? "Préparation des slides…" : "Commencer"}
          </button>
        </footer>
      </form>
    </div>
  );
}
