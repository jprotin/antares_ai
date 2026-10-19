// Connexions → services (port de services.js) : RAG, recherche web, Claude, serveurs MCP.
// Chaque section se teste et s'enregistre à part ; les jetons ne sont jamais réaffichés.
import { useState, type ReactNode } from "react";

import { deleteResource, sendJson } from "@/lib/api";

import type { McpServer, ServicesState } from "./types";

type Outcome = {
  ok: boolean;
  detail?: string;
  seconds?: number;
  error?: string;
};

function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function secretPlaceholder(defined: boolean): string {
  return defined ? "••• défini (laisser vide pour le garder)" : "aucun";
}

function TextField({
  label,
  name,
  value,
  onChange,
  type = "text",
  placeholder = "",
  hidden = false,
}: {
  label: string;
  name: string;
  value: string;
  onChange(value: string): void;
  type?: string;
  placeholder?: string;
  hidden?: boolean;
}) {
  return (
    <label hidden={hidden}>
      {label}
      <input
        type={type}
        name={name}
        placeholder={placeholder}
        value={value}
        // Jetons : jamais proposés à l'enregistrement par le navigateur
        autoComplete={type === "password" ? "new-password" : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function CheckField({
  label,
  name,
  checked,
  onChange,
}: {
  label: string;
  name: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="checkbox">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />{" "}
      {label}
    </label>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="service agent-card">
      <h3 className="service__title">{title}</h3>
      {hint && <p className="settings__hint">{hint}</p>}
      {children}
    </section>
  );
}

// Boutons Tester / Enregistrer d'une section, avec ligne de résultat
function Actions<T>({
  read,
  test,
  save,
}: {
  read(): T;
  test(values: T): Promise<Outcome>;
  save(values: T): Promise<void>;
}) {
  const [result, setResult] = useState({ text: "", error: false });
  async function onTest() {
    setResult({ text: "Test en cours…", error: false });
    try {
      const outcome = await test(read());
      setResult({
        error: !outcome.ok,
        text: outcome.ok
          ? `${outcome.detail}${outcome.seconds !== undefined ? ` (${outcome.seconds} s)` : ""}`
          : `Échec : ${outcome.error}`,
      });
    } catch (reason) {
      setResult({ text: (reason as Error).message, error: true });
    }
  }
  async function onSave() {
    try {
      await save(read());
      setResult({
        text: "Enregistré (pris en compte immédiatement).",
        error: false,
      });
    } catch (reason) {
      setResult({ text: (reason as Error).message, error: true });
    }
  }
  return (
    <>
      <div className="agent-card__actions">
        <button
          type="button"
          className="preview-button"
          onClick={() => void onTest()}
        >
          Tester
        </button>
        <button
          type="button"
          className="preview-button"
          onClick={() => void onSave()}
        >
          Enregistrer
        </button>
      </div>
      <p
        className={`settings__hint${result.error ? " settings__error" : ""}`}
        role="status"
      >
        {result.text}
      </p>
    </>
  );
}

function RagSection({
  rag,
  onSaved,
}: {
  rag: ServicesState["rag"];
  onSaved(): void;
}) {
  const [mode, setMode] = useState(rag.mode);
  const [url, setUrl] = useState(rag.url ?? "");
  const [qdrant, setQdrant] = useState(rag.qdrant_url ?? "");
  const [token, setToken] = useState("");
  const read = () => ({
    mode: mode || "none",
    url: url.trim(),
    qdrant_url: qdrant.trim(),
    write_token: token,
  });
  // Mode intégré : adresses du déploiement ; celles du RAG existant restent enregistrées
  const existing = mode === "existing";
  return (
    <Section
      title="RAG (documentation des projets)"
      hint="Service compatible (POST /query, POST/DELETE /documents : RAG d'ai-to-boost ou RAG intégré), et Qdrant pour la liste des projets."
    >
      <div className="service__modes">
        {(
          [
            ["existing", "RAG existant"],
            ["none", "Aucun (documentation masquée)"],
            ["integrated", "RAG intégré à antares (profil rag-integre)"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="checkbox">
            <input
              type="radio"
              name="rag-mode"
              value={value}
              checked={mode === value}
              onChange={() => setMode(value)}
            />{" "}
            {label}
          </label>
        ))}
      </div>
      <TextField
        label="Adresse du service RAG"
        name="url"
        value={url}
        onChange={setUrl}
        hidden={!existing}
      />
      <TextField
        label="Qdrant (liste des projets)"
        name="qdrant"
        value={qdrant}
        onChange={setQdrant}
        hidden={!existing}
      />
      <TextField
        label="Jeton d'écriture (fiches de connaissance)"
        name="token"
        type="password"
        placeholder={secretPlaceholder(rag.has_write_token)}
        value={token}
        onChange={setToken}
        hidden={!existing}
      />
      <p className="settings__hint" hidden={mode !== "integrated"}>
        Adresses et jeton fixés par le déploiement (services antares-rag et
        antares-qdrant). Documents : Réglages → Projet → Projets du RAG intégré.
      </p>
      <Actions
        read={read}
        test={(values) =>
          sendJson<Outcome>("api/connections/services/rag/test", "POST", values)
        }
        save={async (values) => {
          await sendJson("api/connections/services/rag", "PUT", values);
          onSaved();
        }}
      />
    </Section>
  );
}

function SearchSection({
  search,
  onSaved,
}: {
  search: ServicesState["search"];
  onSaved(): void;
}) {
  const [enabled, setEnabled] = useState(Boolean(search.enabled));
  const [url, setUrl] = useState(search.url ?? "");
  return (
    <Section
      title="Recherche web"
      hint="Métamoteur SearXNG utilisé pour les questions sur l'actuel."
    >
      <CheckField
        label="Recherche web active"
        name="enabled"
        checked={enabled}
        onChange={setEnabled}
      />
      <TextField
        label="Adresse SearXNG"
        name="url"
        value={url}
        onChange={setUrl}
      />
      <Actions
        read={() => ({ enabled, url: url.trim() })}
        test={(values) =>
          sendJson<Outcome>(
            "api/connections/services/search/test",
            "POST",
            values,
          )
        }
        save={async (values) => {
          await sendJson("api/connections/services/search", "PUT", values);
          onSaved();
        }}
      />
    </Section>
  );
}

function ClaudeSection({
  claude,
  onSaved,
}: {
  claude: ServicesState["claude"];
  onSaved(): void;
}) {
  const [enabled, setEnabled] = useState(Boolean(claude.enabled));
  const [url, setUrl] = useState(claude.url ?? "");
  const [token, setToken] = useState("");
  const [models, setModels] = useState(claude.models.join(", "));
  return (
    <Section
      title="Claude (claude-bridge d'ai-to-boost)"
      hint="Exécute Claude Code sur ton abonnement ; hors local, coupé hors ligne et pendant un partage."
    >
      <CheckField
        label="Modèles Claude proposés"
        name="enabled"
        checked={enabled}
        onChange={setEnabled}
      />
      <TextField
        label="Adresse du bridge"
        name="url"
        value={url}
        onChange={setUrl}
      />
      <TextField
        label="Jeton du bridge"
        name="token"
        type="password"
        placeholder={secretPlaceholder(claude.has_token)}
        value={token}
        onChange={setToken}
      />
      <TextField
        label="Modèles (séparés par des virgules)"
        name="models"
        value={models}
        onChange={setModels}
      />
      <Actions
        read={() => ({
          enabled,
          url: url.trim(),
          token,
          models: models
            .split(",")
            .map((m) => m.trim())
            .filter(Boolean),
        })}
        test={(values) =>
          sendJson<Outcome>(
            "api/connections/services/claude/test",
            "POST",
            values,
          )
        }
        save={async (values) => {
          await sendJson("api/connections/services/claude", "PUT", values);
          onSaved();
        }}
      />
    </Section>
  );
}

type McpTest = {
  ok: boolean;
  server?: string;
  tools: { name: string }[];
  seconds?: number;
  error?: string;
};

const toolsText = (outcome: McpTest) =>
  `${outcome.server} · ${outcome.tools.length} outil(s) : ${outcome.tools.map((t) => t.name).join(", ")}`;

function McpRow({ server, rerender }: { server: McpServer; rerender(): void }) {
  const [result, setResult] = useState({ text: "", error: false });
  async function test() {
    setResult({ text: "Test en cours…", error: false });
    let outcome: McpTest;
    try {
      outcome = await sendJson<McpTest>("api/connections/mcp/test", "POST", {
        ...server,
        token: "",
        keep_token: true,
      });
    } catch (reason) {
      setResult({ text: `Échec : ${(reason as Error).message}`, error: true });
      return;
    }
    setResult({
      error: !outcome.ok,
      text: outcome.ok
        ? `${toolsText(outcome)} (${outcome.seconds} s)`
        : `Échec : ${outcome.error}`,
    });
  }
  async function remove() {
    if (!window.confirm(`Supprimer le serveur MCP « ${server.name} » ?`))
      return;
    try {
      await deleteResource(`api/connections/mcp/${server.id}`);
      rerender();
    } catch (reason) {
      setResult({ text: (reason as Error).message, error: true });
    }
  }
  return (
    <div className="service__row">
      <span className="option__detail">
        {`${server.name} · ${server.transport} · ${server.url}${server.has_token ? " · jeton défini" : ""}${server.enabled ? "" : " · inactif"}`}
      </span>
      <div className="agent-card__actions">
        <button
          type="button"
          className="preview-button"
          onClick={() => void test()}
        >
          Tester
        </button>
        <button
          type="button"
          className="preview-button"
          onClick={() => void remove()}
        >
          Supprimer
        </button>
      </div>
      <p className={`settings__hint${result.error ? " settings__error" : ""}`}>
        {result.text}
      </p>
    </div>
  );
}

function McpSection({
  servers,
  rerender,
}: {
  servers: McpServer[];
  rerender(): void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState("http");
  const [token, setToken] = useState("");
  const read = () => {
    const label = name.trim();
    return {
      id: slug(label),
      name: label,
      url: url.trim(),
      transport,
      token,
      enabled: true,
      keep_token: false,
    };
  };
  return (
    <Section
      title="Serveurs MCP"
      hint="Outils externes (Model Context Protocol) en HTTP : « streamable HTTP » ou SSE. Un serveur en ligne de commande (stdio) passe par un relais HTTP (cf. README). Utilisation dans les conversations : lot suivant."
    >
      <div className="service__list">
        {servers.map((server) => (
          <McpRow key={server.id} server={server} rerender={rerender} />
        ))}
        {!servers.length && (
          <p className="settings__hint">Aucun serveur MCP.</p>
        )}
      </div>
      <h4 className="service__subtitle">Ajouter un serveur</h4>
      <div className="service__add">
        <TextField label="Nom" name="name" value={name} onChange={setName} />
        <TextField
          label="Adresse (ex. http://serveur:8000/mcp)"
          name="url"
          value={url}
          onChange={setUrl}
        />
        <label>
          Transport
          <select
            value={transport}
            onChange={(event) => setTransport(event.target.value)}
          >
            <option value="http">Streamable HTTP</option>
            <option value="sse">SSE (ancien)</option>
          </select>
        </label>
        <TextField
          label="Jeton (optionnel)"
          name="token"
          type="password"
          value={token}
          onChange={setToken}
        />
      </div>
      <Actions
        read={read}
        test={async (values) => {
          const outcome = await sendJson<McpTest>(
            "api/connections/mcp/test",
            "POST",
            values,
          );
          return outcome.ok
            ? { ok: true, detail: toolsText(outcome), seconds: outcome.seconds }
            : outcome;
        }}
        save={async (values) => {
          await sendJson(`api/connections/mcp/${values.id}`, "PUT", values);
          rerender();
        }}
      />
    </Section>
  );
}

export function Services({
  services,
  onSaved,
  rerender,
}: {
  services: ServicesState;
  onSaved(): void;
  rerender(): void;
}) {
  return (
    <div className="services" id="services">
      <RagSection rag={services.rag} onSaved={onSaved} />
      <SearchSection search={services.search} onSaved={onSaved} />
      <ClaudeSection claude={services.claude} onSaved={onSaved} />
      <McpSection servers={services.mcp} rerender={rerender} />
    </div>
  );
}
