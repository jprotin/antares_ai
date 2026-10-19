// Fenêtre Agents (port de agents.js) : fiches « consignes » regroupées par domaine,
// filtrables par utilité ; stockées par le routeur LLM (/api/agents).
import { Dialog } from "radix-ui";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { deleteResource, getJson, sendJson } from "@/lib/api";
import { modelLabel } from "@/lib/labels";
import { store } from "@/state/store";
import type { Agent } from "@/types/api";

import "@/styles/legacy-dialogs.css";

const EXAMPLE_INSTRUCTIONS =
  "Ex. : Tu es un expert Kubernetes. Demande d'abord le symptôme et la sortie de " +
  "kubectl describe. Propose une hypothèse à la fois avec la commande pour la vérifier.";

type StoredAgent = Agent & { project?: string; model?: string };
type Meta = { domains: string[]; usages: string[] };
type Catalog = {
  agents: StoredAgent[];
  domains: string[];
  usages: string[];
  projects: { id: string }[];
  models: { name: string; label?: string }[];
};

const FIELDS = [
  "name",
  "domain",
  "usage",
  "description",
  "instructions",
  "project",
  "model",
] as const;
type Draft = Record<(typeof FIELDS)[number], string>;

const emptyDraft = (): Draft =>
  Object.fromEntries(FIELDS.map((key) => [key, ""])) as Draft;

async function loadCatalog(): Promise<Catalog> {
  const [agents, meta, projects, models] = await Promise.all([
    getJson<StoredAgent[]>("api/agents"),
    getJson<Meta>("api/agents/meta"),
    getJson<{ id: string }[]>("api/projects").catch(() => []),
    getJson<{ name: string; label?: string }[]>("api/models").catch(() => []),
  ]);
  // Listes proposées + valeurs personnelles déjà utilisées
  return {
    agents,
    domains: [
      ...new Set([...meta.domains, ...agents.map((a) => a.domain ?? "")]),
    ],
    usages: [...new Set([...meta.usages, ...agents.map((a) => a.usage ?? "")])],
    projects,
    models,
  };
}

// Les sélecteurs de l'écran d'appel suivent la liste des agents
async function agentsChanged() {
  const agents = await getJson<Agent[]>("api/agents");
  store.getState().setProfile({ agents });
}

export function AgentsDialog() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  // null : formulaire fermé ; { agent: null } : nouvel agent
  const [editing, setEditing] = useState<{ agent: StoredAgent | null } | null>(
    null,
  );
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const nameInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setCatalog(await loadCatalog());
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadCatalog()
      .then((loaded) => !cancelled && setCatalog(loaded))
      .catch(
        (reason: Error) =>
          !cancelled && setError(`Agents indisponibles : ${reason.message}`),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (editing) nameInput.current?.focus();
  }, [editing]);

  function openForm(agent: StoredAgent | null) {
    setDraft(
      Object.fromEntries(
        FIELDS.map((key) => [key, String(agent?.[key] ?? "")]),
      ) as Draft,
    );
    setError("");
    setEditing({ agent });
  }

  async function removeAgent(agent: StoredAgent) {
    if (!window.confirm(`Supprimer l'agent « ${agent.name} » ?`)) return;
    try {
      await deleteResource(`api/agents/${encodeURIComponent(agent.id)}`);
      await refresh();
      await agentsChanged();
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const body = Object.fromEntries(
      FIELDS.map((key) => [key, draft[key].trim()]),
    );
    const current = editing?.agent;
    try {
      await sendJson(
        current ? `api/agents/${encodeURIComponent(current.id)}` : "api/agents",
        current ? "PUT" : "POST",
        body,
      );
      setEditing(null);
      await refresh();
      await agentsChanged();
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  const field = (key: keyof Draft) => ({
    id: `agent-${key}`,
    value: draft[key],
    onChange: (event: { target: { value: string } }) =>
      setDraft((d) => ({ ...d, [key]: event.target.value })),
  });

  const shown = (catalog?.agents ?? []).filter(
    (agent) => !filter || agent.usage === filter,
  );
  const domains = [...new Set(shown.map((agent) => agent.domain ?? ""))].sort();

  return (
    <div className="settings__form">
      <header className="settings__header dialog__header agents__header">
        <div>
          <Dialog.Title asChild>
            <h2>Agents</h2>
          </Dialog.Title>
          <p>Consignes réutilisables, regroupées par domaine.</p>
        </div>
        <select
          id="agents-filter"
          aria-label="Filtrer par utilité"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="">Toutes les utilités</option>
          {(catalog?.usages ?? []).map((usage) => (
            <option key={usage} value={usage}>
              {usage}
            </option>
          ))}
        </select>
      </header>

      <div className="agents__list" id="agents-list">
        {catalog && !shown.length && (
          <p className="agents__empty">Aucun agent pour ce filtre.</p>
        )}
        {domains.map((domain) => (
          <section key={domain} className="agents__group">
            <h3>{domain}</h3>
            {shown
              .filter((agent) => (agent.domain ?? "") === domain)
              .map((agent) => {
                const extras = [
                  agent.project && `projet ${agent.project}`,
                  agent.model && modelLabel(agent.model),
                ].filter(Boolean);
                return (
                  <article key={agent.id} className="agent-card">
                    <div className="agent-card__head">
                      <span className="option__title">{agent.name}</span>
                      <span className="badge badge--unknown">
                        {agent.usage}
                      </span>
                    </div>
                    <p className="option__detail">
                      {[agent.description, ...extras]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <div className="agent-card__actions">
                      <button
                        type="button"
                        className="preview-button"
                        onClick={() => openForm(agent)}
                      >
                        Modifier
                      </button>
                      <button
                        type="button"
                        className="preview-button"
                        onClick={() => void removeAgent(agent)}
                      >
                        Supprimer
                      </button>
                    </div>
                  </article>
                );
              })}
          </section>
        ))}
      </div>

      {editing && (
        <form className="agent-form" id="agent-form" onSubmit={save}>
          <h3 id="agent-form-title">
            {editing.agent
              ? `Modifier « ${editing.agent.name} »`
              : "Nouvel agent"}
          </h3>
          <label>
            Nom
            <input
              ref={nameInput}
              required
              minLength={2}
              maxLength={60}
              {...field("name")}
            />
          </label>
          <div className="agent-form__row">
            <label>
              Domaine
              <input
                list="agent-domains"
                required
                maxLength={40}
                {...field("domain")}
              />
            </label>
            <label>
              Utilité
              <input
                list="agent-usages"
                required
                maxLength={40}
                {...field("usage")}
              />
            </label>
          </div>
          <label>
            Description courte
            <input maxLength={200} {...field("description")} />
          </label>
          <label>
            Instructions (rôle, méthode, format de réponse)
            <textarea
              rows={6}
              required
              minLength={10}
              maxLength={4000}
              placeholder={EXAMPLE_INSTRUCTIONS}
              {...field("instructions")}
            />
          </label>
          <div className="agent-form__row">
            <label>
              Projet (documentation)
              <select {...field("project")}>
                <option value="">Aucun</option>
                {(catalog?.projects ?? []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Modèle
              <select {...field("model")}>
                <option value="">Modèle choisi dans les Réglages</option>
                {(catalog?.models ?? []).map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.label ?? model.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="settings__hint">
            Un modèle différent de celui des Réglages est chargé en mémoire à la
            première réponse de l'agent : quelques secondes de plus.
          </p>
          <datalist id="agent-domains">
            {(catalog?.domains ?? []).map((domain) => (
              <option key={domain} value={domain} />
            ))}
          </datalist>
          <datalist id="agent-usages">
            {(catalog?.usages ?? []).map((usage) => (
              <option key={usage} value={usage} />
            ))}
          </datalist>
          <footer className="settings__actions">
            <button
              type="button"
              className="button-ghost"
              id="agent-cancel"
              onClick={() => setEditing(null)}
            >
              Annuler
            </button>
            <button type="submit" className="button-primary">
              Enregistrer
            </button>
          </footer>
        </form>
      )}

      <p className="settings__error" id="agents-error" role="alert">
        {error}
      </p>

      <footer className="settings__actions dialog__footer">
        <button
          type="button"
          className="button-ghost"
          id="agent-new"
          onClick={() => openForm(null)}
        >
          Nouvel agent
        </button>
        <Dialog.Close asChild>
          <button type="button" className="button-primary" id="agents-close">
            Fermer
          </button>
        </Dialog.Close>
      </footer>
    </div>
  );
}
