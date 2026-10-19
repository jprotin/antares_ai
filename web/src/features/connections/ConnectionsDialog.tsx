// Connexions (port de connections.js) : fournisseurs de modèles (Ollama, LiteLLM, API
// compatibles OpenAI), modèle de repli, puis services (RAG, recherche, Claude, MCP).
// Les clés d'API restent côté routeur : l'interface ne sait que si une clé est définie.
import { Dialog } from "radix-ui";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { saveSetting } from "@/app/bootstrap";
import { deleteResource, getJson, sendJson } from "@/lib/api";
import { modelLabel, type ModelEntry } from "@/lib/labels";
import { store } from "@/state/store";

import { Services } from "./Services";
import type { Connections, Provider, ProviderTest } from "./types";
import "@/styles/legacy-dialogs.css";
import "./connections.css";
import { slug } from "./slug";

const PLACEHOLDERS: Record<string, string> = {
  ollama: "http://ollama:11434",
  openai: "https://api.exemple.com/v1 (l'adresse inclut /v1)",
};

// Premier mot : révèle un raisonnement silencieux ou un modèle trop lourd
function firstTokenText(test: ProviderTest): string {
  const first = test.firstToken;
  if (!first) return "";
  if (first.error) return ` · 1er mot : échec (${first.error})`;
  let text = ` · 1er mot en ${first.seconds} s (${test.firstModel})`;
  if (first.reasoning) {
    text += ` — le modèle a réfléchi (${first.reasoning} tokens) : cocher « Couper le raisonnement »`;
  } else if ((first.seconds ?? 0) > 5) {
    text += " — lent : chargement du modèle, ou modèle trop gros pour la VRAM";
  }
  return text;
}

type Draft = {
  name: string;
  id: string;
  type: "ollama" | "openai";
  url: string;
  key: string;
  local: boolean;
  enabled: boolean;
  noReasoning: boolean;
};

type Message = { text: string; error: boolean };

function ProviderForm({
  editing,
  onClose,
  onSaved,
}: {
  editing: Provider | null;
  onClose(): void;
  onSaved(): void;
}) {
  const [draft, setDraft] = useState<Draft>({
    name: editing?.name ?? "",
    id: editing?.id ?? "",
    type: editing?.type ?? "openai",
    url: editing?.url ?? "",
    key: "",
    local: editing?.local ?? false,
    enabled: editing?.enabled ?? true,
    noReasoning: editing?.no_reasoning ?? editing?.local ?? false,
  });
  // Nouveau fournisseur : la coupure du raisonnement suit « local » tant qu'on n'y touche pas
  const [reasoningTouched, setReasoningTouched] = useState(Boolean(editing));
  const [result, setResult] = useState<Message>({ text: "", error: false });
  const nameField = useRef<HTMLInputElement>(null);

  useEffect(() => nameField.current?.focus(), []);

  const update = (patch: Partial<Draft>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const body = () => ({
    id: draft.id.trim(),
    name: draft.name.trim(),
    type: draft.type,
    url: draft.url.trim(),
    api_key: draft.key,
    local: draft.local,
    enabled: draft.enabled,
    no_reasoning: draft.noReasoning,
    keep_key: true,
  });

  function showResult(test: ProviderTest) {
    setResult({
      error: !test.ok || Boolean(test.firstToken?.reasoning),
      text: test.ok
        ? `Joignable en ${test.seconds} s : ${test.count} modèle(s)${firstTokenText(test)}`
        : `Échec : ${test.error}`,
    });
  }

  async function onTest() {
    setResult({ text: "Test en cours…", error: false });
    try {
      showResult(
        await sendJson<ProviderTest>("api/connections/test", "POST", body()),
      );
    } catch (reason) {
      showResult({ ok: false, error: (reason as Error).message });
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const provider = body();
    try {
      await sendJson(
        `api/connections/providers/${provider.id}`,
        "PUT",
        provider,
      );
      onSaved();
    } catch (reason) {
      setResult({ text: (reason as Error).message, error: true });
    }
  }

  return (
    <form className="agent-form" id="provider-form" onSubmit={onSubmit}>
      <h3 id="provider-form-title">
        {editing ? `Modifier « ${editing.name} »` : "Nouveau fournisseur"}
      </h3>
      <div className="agent-form__row">
        <label>
          Nom
          <input
            ref={nameField}
            id="provider-name"
            required
            maxLength={60}
            value={draft.name}
            onChange={(event) =>
              update({
                name: event.target.value,
                ...(editing ? {} : { id: slug(event.target.value) }),
              })
            }
          />
        </label>
        <label>
          Identifiant (préfixe des modèles)
          <input
            id="provider-id"
            required
            // Tiret échappé : motif valide aussi en mode v (FE-8)
            pattern="[a-z0-9][a-z0-9\-]{0,31}"
            maxLength={32}
            disabled={Boolean(editing)}
            value={draft.id}
            onChange={(event) => update({ id: event.target.value })}
          />
        </label>
      </div>
      <div className="agent-form__row">
        <label>
          Type
          <select
            id="provider-type"
            value={draft.type}
            onChange={(event) =>
              update({ type: event.target.value as Draft["type"] })
            }
          >
            <option value="ollama">Ollama</option>
            <option value="openai">
              API compatible OpenAI (LiteLLM, OpenAI, Mistral…)
            </option>
          </select>
        </label>
        <label>
          Adresse
          <input
            id="provider-url"
            required
            maxLength={300}
            placeholder={PLACEHOLDERS[draft.type]}
            value={draft.url}
            onChange={(event) => update({ url: event.target.value })}
          />
        </label>
      </div>
      <label>
        Clé d'API (optionnelle)
        <input
          id="provider-key"
          type="password"
          autoComplete="new-password"
          maxLength={400}
          placeholder={
            editing?.has_key
              ? "••• définie (laisser vide pour la garder)"
              : "aucune"
          }
          value={draft.key}
          onChange={(event) => update({ key: event.target.value })}
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          id="provider-local"
          checked={draft.local}
          onChange={(event) =>
            update({
              local: event.target.checked,
              ...(reasoningTouched
                ? {}
                : { noReasoning: event.target.checked }),
            })
          }
        />{" "}
        Service local (cette machine ou ton réseau) : sinon « hors local »,
        coupé hors ligne et pendant un partage
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          id="provider-noreasoning"
          checked={draft.noReasoning}
          onChange={(event) => {
            setReasoningTouched(true);
            update({ noReasoning: event.target.checked });
          }}
        />{" "}
        Couper le raisonnement (gemma4, qwen3 via Ollama ou LiteLLM : sinon
        plusieurs secondes de réflexion silencieuse avant le premier mot)
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          id="provider-enabled"
          checked={draft.enabled}
          onChange={(event) => update({ enabled: event.target.checked })}
        />{" "}
        Actif
      </label>
      <p
        className={`settings__hint${result.error ? " settings__error" : ""}`}
        id="provider-result"
        role="status"
      >
        {result.text}
      </p>
      <footer className="settings__actions">
        <button
          type="button"
          className="button-ghost"
          id="provider-cancel"
          onClick={onClose}
        >
          Annuler
        </button>
        <button
          type="button"
          className="button-ghost"
          id="provider-test"
          onClick={() => void onTest()}
        >
          Tester
        </button>
        <button type="submit" className="button-primary">
          Enregistrer
        </button>
      </footer>
    </form>
  );
}

function ProviderCard({
  provider,
  status,
  removable,
  onEdit,
  onRemoved,
  onTested,
}: {
  provider: Provider;
  status: Connections["status"][string];
  removable: boolean;
  onEdit(): void;
  onRemoved(): void;
  onTested(message: Message): void;
}) {
  const [testLabel, setTestLabel] = useState("Tester");
  const detail = [
    provider.url,
    `modèles : ${provider.id}/…`,
    provider.has_key ? "clé définie" : "",
    status?.error
      ? `injoignable (${status.error})`
      : status
        ? `${status.count} modèle(s)`
        : "",
  ].filter(Boolean);

  async function test() {
    setTestLabel("…");
    let outcome: ProviderTest;
    try {
      outcome = await sendJson<ProviderTest>("api/connections/test", "POST", {
        ...provider,
        api_key: "",
        keep_key: true,
      });
    } catch (reason) {
      setTestLabel("Échec");
      onTested({
        error: true,
        text: `${provider.name} : ${(reason as Error).message}`,
      });
      return;
    }
    setTestLabel(outcome.ok ? `OK · ${outcome.count}` : "Échec");
    onTested({
      error: !outcome.ok,
      text: outcome.ok
        ? `${provider.name} : ${outcome.count} modèle(s)${firstTokenText(outcome)}`
        : `${provider.name} : ${outcome.error}`,
    });
  }

  async function remove() {
    if (!window.confirm(`Supprimer le fournisseur « ${provider.name} » ?`))
      return;
    try {
      await deleteResource(`api/connections/providers/${provider.id}`);
      onRemoved();
    } catch (reason) {
      onTested({ error: true, text: (reason as Error).message });
    }
  }

  return (
    <article className="agent-card">
      <div className="agent-card__head">
        <span className="option__title">{provider.name}</span>
        <span className="badge badge--unknown">
          {provider.type === "ollama" ? "Ollama" : "API OpenAI"}
        </span>
        <span
          className={`badge ${provider.local ? "badge--gpu" : "badge--cloud"}`}
        >
          {provider.local ? "local" : "hors local"}
        </span>
        {!provider.enabled && (
          <span className="badge badge--unknown">inactif</span>
        )}
      </div>
      <p className={`option__detail${status?.error ? " settings__error" : ""}`}>
        {detail.join(" · ")}
      </p>
      <div className="agent-card__actions">
        <button
          type="button"
          className="preview-button"
          onClick={() => void test()}
        >
          {testLabel}
        </button>
        <button type="button" className="preview-button" onClick={onEdit}>
          Modifier
        </button>
        {removable && (
          <button
            type="button"
            className="preview-button"
            onClick={() => void remove()}
          >
            Supprimer
          </button>
        )}
      </div>
    </article>
  );
}

// Repli : modèles hors Claude ; le modèle réglé reste listé même s'il ne répond plus
function fallbackOptions(models: ModelEntry[], current: string) {
  const names = models
    .filter((m) => m.provider !== "claude")
    .map((m) => ({ name: m.name, available: m.available }));
  if (current && !names.some((m) => m.name === current))
    names.unshift({ name: current, available: false });
  return names;
}

async function load() {
  const [connections, models] = await Promise.all([
    getJson<Connections>("api/connections"),
    getJson<ModelEntry[]>("api/models"),
  ]);
  return { connections, models };
}

export function ConnectionsDialog() {
  const [data, setData] = useState<{
    connections: Connections;
    models: ModelEntry[];
  }>();
  // Formulaire : undefined fermé, null nouveau fournisseur, sinon fournisseur modifié
  const [editing, setEditing] = useState<Provider | null>();
  const [message, setMessage] = useState<Message>({ text: "", error: true });
  const [version, setVersion] = useState(0);
  // Un changement de fournisseur ou de service : Réglages recharge modèles et projets

  const apply = useCallback((loaded: Awaited<ReturnType<typeof load>>) => {
    setData(loaded);
    setVersion((v) => v + 1);
  }, []);
  const fail = useCallback(
    (reason: Error) => setMessage({ text: reason.message, error: true }),
    [],
  );
  const render = useCallback(
    () => load().then(apply).catch(fail),
    [apply, fail],
  );

  useEffect(() => {
    load().then(apply).catch(fail);
  }, [apply, fail]);

  // Réglages recharge ses listes à chaque changement (même fenêtre fermée entre-temps)
  const markChanged = () => {
    store.getState().catalogChanged();
  };

  async function chooseFallback(value: string) {
    try {
      await saveSetting({ fallback: value });
      markChanged();
      await render();
    } catch (reason) {
      setMessage({ text: (reason as Error).message, error: true });
    }
  }

  const connections = data?.connections;
  const fallbackModel = connections?.fallbackModel ?? "";
  const fallbackProvider = fallbackModel.split("/")[0];

  return (
    <div className="settings__form">
      <header className="settings__header dialog__header">
        <Dialog.Title asChild>
          <h2>Connexions</h2>
        </Dialog.Title>
        <p>
          Fournisseurs de modèles : Ollama (sur cette machine ou ailleurs),
          LiteLLM ou toute API compatible OpenAI. Leurs modèles apparaissent
          dans les Réglages.
        </p>
      </header>
      <div className="agents__list" id="providers-list">
        {connections?.providers.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            status={connections.status[provider.id]}
            removable={provider.id !== fallbackProvider}
            onEdit={() => {
              setMessage({ text: "", error: true });
              setEditing(provider);
            }}
            onRemoved={() => {
              markChanged();
              void render();
            }}
            onTested={setMessage}
          />
        ))}
      </div>

      <label className="fallback">
        Modèle de repli (quand le modèle choisi est indisponible : hors ligne,
        partage, fournisseur injoignable)
        <select
          id="fallback-model"
          value={fallbackModel}
          onChange={(event) => void chooseFallback(event.target.value)}
        >
          <option value="">
            Automatique : premier modèle disponible, local d'abord
          </option>
          {fallbackOptions(data?.models ?? [], fallbackModel).map((m) => (
            <option key={m.name} value={m.name}>
              {`${modelLabel(m.name)}${m.available ? "" : " — indisponible"}`}
            </option>
          ))}
        </select>
        <span
          className={
            fallbackModel || !data ? "settings__hint" : "settings__error"
          }
          id="fallback-hint"
          role="status"
        >
          {fallbackModel || !data
            ? ""
            : "Repli non réglé : choisir un modèle qui tient dans la VRAM avec la voix."}
        </span>
      </label>

      {editing !== undefined && (
        <ProviderForm
          key={editing?.id ?? "nouveau"}
          editing={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            markChanged();
            void render();
          }}
        />
      )}

      <p
        className={
          message.error ? "settings__error" : "settings__error settings__hint"
        }
        id="connections-error"
        role="alert"
      >
        {message.text}
      </p>
      <div className="settings__actions">
        <button
          type="button"
          className="button-ghost"
          id="provider-new"
          onClick={() => {
            setMessage({ text: "", error: true });
            setEditing(null);
          }}
        >
          Ajouter un fournisseur
        </button>
      </div>

      {connections && (
        <Services
          key={version}
          services={connections.services}
          onSaved={markChanged}
          rerender={() => void render()}
        />
      )}

      <footer className="settings__actions dialog__footer">
        <Dialog.Close asChild>
          <button
            type="button"
            className="button-primary"
            id="connections-close"
          >
            Fermer
          </button>
        </Dialog.Close>
      </footer>
    </div>
  );
}
