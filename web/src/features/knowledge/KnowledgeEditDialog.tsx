// Fiche de connaissance (port de knowledge.js) : relecture du brouillon rédigé par le
// modèle, choix du projet, fiches proches à remplacer, indexation
import { Dialog } from "radix-ui";
import { useEffect, useState, type FormEvent } from "react";
import { useStore } from "zustand";

import { sendJson } from "@/lib/api";
import { store } from "@/state/store";

import {
  editor,
  findSimilar,
  projectIds,
  type Card,
  type Similar,
} from "./knowledge";
import "@/styles/legacy-dialogs.css";

function SimilarList({
  similar,
  checked,
  onToggle,
}: {
  similar: Similar[];
  checked: string[];
  onToggle(id: string, on: boolean): void;
}) {
  if (!similar.length)
    return (
      <p className="settings__hint">Aucune fiche proche dans ce projet.</p>
    );
  return (
    <>
      <p className="settings__hint">
        Fiches proches déjà indexées : cochez celles que celle-ci remplace
        (elles deviendront obsolètes).
      </p>
      {similar.map((card) => (
        <label key={card.id} className="option">
          <input
            type="checkbox"
            value={card.id}
            checked={checked.includes(card.id)}
            onChange={(event) => onToggle(card.id, event.target.checked)}
          />
          <span>
            <span className="option__title">{card.title}</span>
            <span className="option__detail">
              similarité {card.score} ·{" "}
              {new Date(card.created * 1000).toLocaleDateString("fr-FR")}
            </span>
          </span>
          <span />
        </label>
      ))}
    </>
  );
}

// Formulaire d'une fiche : repart du brouillon à chaque rédaction (clé `run`)
function KnowledgeForm({
  draft,
  initialSimilar,
  onStatus,
}: {
  draft: Card;
  initialSimilar: Similar[];
  onStatus(text: string): void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);
  const [tags, setTags] = useState((draft.tags ?? []).join(", "));
  const [validUntil, setValidUntil] = useState(draft.valid_until ?? "");
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState(draft.project);
  const [similar, setSimilar] = useState(initialSimilar);
  const [replaces, setReplaces] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void projectIds().then((ids) => {
      if (cancelled) return;
      setProjects(ids);
      // Projet inconnu : fiche commune
      setProject((current) => (ids.includes(current) ? current : ""));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function changeProject(next: string) {
    setProject(next);
    setReplaces([]);
    setSimilar(await findSimilar(title, body, next));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const card = await sendJson<Card>("api/knowledge", "POST", {
        card: {
          ...draft,
          title,
          body,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          valid_until: validUntil || null,
          project,
        },
        replaces,
      });
      store.getState().closeDialog("knowledge-edit");
      store
        .getState()
        .systemLine(
          `Fiche indexée : ${card.title} (${card.project || "commun"})` +
            (replaces.length
              ? ` — ${replaces.length} fiche(s) remplacée(s)`
              : ""),
        );
    } catch (error) {
      onStatus(`Indexation impossible : ${(error as Error).message}`);
      setSaving(false);
    }
  }

  return (
    <form className="agent-form" id="knowledge-form" onSubmit={save}>
      <label>
        Titre
        <input
          id="knowledge-title"
          required
          maxLength={160}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <div className="agent-form__row">
        <label>
          Projet
          <select
            id="knowledge-project"
            value={project}
            onChange={(event) => void changeProject(event.target.value)}
          >
            <option value="">Commun (tous projets)</option>
            {projects.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Valable jusqu'au (optionnel)
          <input
            id="knowledge-until"
            type="date"
            value={validUntil}
            onChange={(event) => setValidUntil(event.target.value)}
          />
        </label>
      </div>
      <label>
        Contenu (Markdown, faits et décisions durables)
        <textarea
          id="knowledge-body"
          rows={9}
          required
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      <label>
        Mots-clés (séparés par des virgules)
        <input
          id="knowledge-tags"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
        />
      </label>
      <div className="settings__options" id="knowledge-similar">
        <SimilarList
          similar={similar}
          checked={replaces}
          onToggle={(id, on) =>
            setReplaces((list) =>
              on ? [...list, id] : list.filter((item) => item !== id),
            )
          }
        />
      </div>
      <footer className="settings__actions dialog__footer">
        <Dialog.Close asChild>
          <button type="button" className="button-ghost" id="knowledge-cancel">
            Annuler
          </button>
        </Dialog.Close>
        <button
          type="submit"
          className="button-primary"
          id="knowledge-save"
          disabled={saving}
        >
          Indexer
        </button>
      </footer>
    </form>
  );
}

export function KnowledgeEditDialog() {
  const { run, phase, status, draft, similar } = useStore(editor);
  // Erreur d'indexation : affichée à la place du statut de rédaction
  const [saveError, setSaveError] = useState<{ run: number; text: string }>();
  const error = saveError?.run === run ? saveError.text : undefined;
  return (
    <div className="settings__form">
      <header className="settings__header dialog__header">
        <Dialog.Title asChild>
          <h2>Fiche de connaissance</h2>
        </Dialog.Title>
        <p
          id="knowledge-status"
          role="status"
          className={phase === "error" || error ? "settings__error" : undefined}
        >
          {error ?? status}
        </p>
      </header>
      {phase === "ready" && draft ? (
        <KnowledgeForm
          key={run}
          draft={draft}
          initialSimilar={similar}
          onStatus={(text) => setSaveError({ run, text })}
        />
      ) : (
        <form className="agent-form" id="knowledge-form" hidden />
      )}
    </div>
  );
}
