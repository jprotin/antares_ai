// Connexions → services : RAG, recherche web, Claude, serveurs MCP. Chaque section se
// teste et s'enregistre à part ; les jetons ne sont jamais réaffichés.

import { getJson } from "./settings.js";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function input(label, { type = "text", value = "", placeholder = "", name }) {
  const wrapper = element("label", type === "checkbox" ? "checkbox" : "");
  const field = element("input");
  Object.assign(field, { type, name, placeholder });
  if (type === "checkbox") {
    field.checked = Boolean(value);
    wrapper.append(field, ` ${label}`);
  } else {
    field.value = value ?? "";
    wrapper.append(label, field);
  }
  return wrapper;
}

function secretPlaceholder(defined) {
  return defined ? "••• défini (laisser vide pour le garder)" : "aucun";
}

async function send(url, method, body) {
  return getJson(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sectionShell(title, hint) {
  const section = element("section", "service agent-card");
  section.append(element("h3", "service__title", title));
  if (hint) section.append(element("p", "settings__hint", hint));
  return section;
}

// Boutons Tester / Enregistrer d'une section, avec ligne de résultat
function actions(section, { read, test, save }) {
  const result = element("p", "settings__hint");
  result.setAttribute("role", "status");
  const bar = element("div", "agent-card__actions");
  const testButton = element("button", "preview-button", "Tester");
  testButton.type = "button";
  testButton.addEventListener("click", async () => {
    result.classList.remove("settings__error");
    result.textContent = "Test en cours…";
    try {
      const outcome = await test(read());
      result.classList.toggle("settings__error", !outcome.ok);
      result.textContent = outcome.ok
        ? `${outcome.detail}${outcome.seconds !== undefined ? ` (${outcome.seconds} s)` : ""}`
        : `Échec : ${outcome.error}`;
    } catch (err) {
      result.classList.add("settings__error");
      result.textContent = err.message;
    }
  });
  const saveButton = element("button", "preview-button", "Enregistrer");
  saveButton.type = "button";
  saveButton.addEventListener("click", async () => {
    try {
      await save(read());
      result.classList.remove("settings__error");
      result.textContent = "Enregistré (pris en compte immédiatement).";
    } catch (err) {
      result.classList.add("settings__error");
      result.textContent = err.message;
    }
  });
  bar.append(testButton, saveButton);
  section.append(bar, result);
}

function ragSection(rag, onSaved) {
  const section = sectionShell(
    "RAG (documentation des projets)",
    "Service compatible (POST /query, POST/DELETE /documents : RAG d'ai-to-boost ou RAG intégré), et Qdrant pour la liste des projets.",
  );
  const modes = element("div", "service__modes");
  for (const [value, label, disabled] of [
    ["existing", "RAG existant", false],
    ["none", "Aucun (documentation masquée)", false],
    ["integrated", "RAG intégré à antares (installation : lot suivant)", true],
  ]) {
    const wrapper = element("label", "checkbox");
    const radio = element("input");
    Object.assign(radio, {
      type: "radio",
      name: "rag-mode",
      value,
      checked: rag.mode === value,
      disabled,
    });
    wrapper.append(radio, ` ${label}`);
    modes.append(wrapper);
  }
  const url = input("Adresse du service RAG", { value: rag.url, name: "url" });
  const qdrant = input("Qdrant (liste des projets)", {
    value: rag.qdrant_url,
    name: "qdrant",
  });
  const token = input("Jeton d'écriture (fiches de connaissance)", {
    type: "password",
    placeholder: secretPlaceholder(rag.has_write_token),
    name: "token",
  });
  section.append(modes, url, qdrant, token);
  const read = () => ({
    mode:
      section.querySelector('input[name="rag-mode"]:checked')?.value ?? "none",
    url: url.querySelector("input").value.trim(),
    qdrant_url: qdrant.querySelector("input").value.trim(),
    write_token: token.querySelector("input").value,
  });
  actions(section, {
    read,
    test: (values) => send("api/connections/services/rag/test", "POST", values),
    save: async (values) => {
      await send("api/connections/services/rag", "PUT", values);
      onSaved();
    },
  });
  return section;
}

function searchSection(search, onSaved) {
  const section = sectionShell(
    "Recherche web",
    "Métamoteur SearXNG utilisé pour les questions sur l'actuel.",
  );
  const enabled = input("Recherche web active", {
    type: "checkbox",
    value: search.enabled,
    name: "enabled",
  });
  const url = input("Adresse SearXNG", { value: search.url, name: "url" });
  section.append(enabled, url);
  actions(section, {
    read: () => ({
      enabled: enabled.querySelector("input").checked,
      url: url.querySelector("input").value.trim(),
    }),
    test: (values) =>
      send("api/connections/services/search/test", "POST", values),
    save: async (values) => {
      await send("api/connections/services/search", "PUT", values);
      onSaved();
    },
  });
  return section;
}

function claudeSection(claude, onSaved) {
  const section = sectionShell(
    "Claude (claude-bridge d'ai-to-boost)",
    "Exécute Claude Code sur ton abonnement ; hors local, coupé hors ligne et pendant un partage.",
  );
  const enabled = input("Modèles Claude proposés", {
    type: "checkbox",
    value: claude.enabled,
    name: "enabled",
  });
  const url = input("Adresse du bridge", { value: claude.url, name: "url" });
  const token = input("Jeton du bridge", {
    type: "password",
    placeholder: secretPlaceholder(claude.has_token),
    name: "token",
  });
  const models = input("Modèles (séparés par des virgules)", {
    value: claude.models.join(", "),
    name: "models",
  });
  section.append(enabled, url, token, models);
  actions(section, {
    read: () => ({
      enabled: enabled.querySelector("input").checked,
      url: url.querySelector("input").value.trim(),
      token: token.querySelector("input").value,
      models: models
        .querySelector("input")
        .value.split(",")
        .map((m) => m.trim())
        .filter(Boolean),
    }),
    test: (values) =>
      send("api/connections/services/claude/test", "POST", values),
    save: async (values) => {
      await send("api/connections/services/claude", "PUT", values);
      onSaved();
    },
  });
  return section;
}

function mcpSection(servers, rerender) {
  const section = sectionShell(
    "Serveurs MCP",
    "Outils externes (Model Context Protocol) en HTTP : « streamable HTTP » ou SSE. Un serveur en ligne de commande (stdio) passe par un relais HTTP (cf. README). Utilisation dans les conversations : lot suivant.",
  );
  const list = element("div", "service__list");
  for (const server of servers) {
    const row = element("div", "service__row");
    const text = element(
      "span",
      "option__detail",
      `${server.name} · ${server.transport} · ${server.url}${server.has_token ? " · jeton défini" : ""}${server.enabled ? "" : " · inactif"}`,
    );
    const bar = element("div", "agent-card__actions");
    const result = element("p", "settings__hint");
    const test = element("button", "preview-button", "Tester");
    test.type = "button";
    test.addEventListener("click", async () => {
      result.textContent = "Test en cours…";
      const outcome = await send("api/connections/mcp/test", "POST", {
        ...server,
        token: "",
        keep_token: true,
      });
      result.classList.toggle("settings__error", !outcome.ok);
      result.textContent = outcome.ok
        ? `${outcome.server} · ${outcome.tools.length} outil(s) : ${outcome.tools.map((t) => t.name).join(", ")} (${outcome.seconds} s)`
        : `Échec : ${outcome.error}`;
    });
    const remove = element("button", "preview-button", "Supprimer");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Supprimer le serveur MCP « ${server.name} » ?`))
        return;
      await fetch(`api/connections/mcp/${server.id}`, { method: "DELETE" });
      rerender();
    });
    bar.append(test, remove);
    row.append(text, bar, result);
    list.append(row);
  }
  if (!servers.length) {
    list.append(element("p", "settings__hint", "Aucun serveur MCP."));
  }

  // Ajout d'un serveur
  const form = element("div", "service__add");
  const name = input("Nom", { name: "name" });
  const url = input("Adresse (ex. http://serveur:8000/mcp)", { name: "url" });
  const transport = element("label", "", "Transport");
  const select = element("select");
  select.append(
    Object.assign(element("option", "", "Streamable HTTP"), { value: "http" }),
    Object.assign(element("option", "", "SSE (ancien)"), { value: "sse" }),
  );
  transport.append(select);
  const token = input("Jeton (optionnel)", { type: "password", name: "token" });
  form.append(name, url, transport, token);
  const read = () => {
    const label = name.querySelector("input").value.trim();
    return {
      id: label
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32),
      name: label,
      url: url.querySelector("input").value.trim(),
      transport: select.value,
      token: token.querySelector("input").value,
      enabled: true,
      keep_token: false,
    };
  };
  section.append(
    list,
    element("h4", "service__subtitle", "Ajouter un serveur"),
    form,
  );
  actions(section, {
    read,
    test: async (values) => {
      const outcome = await send("api/connections/mcp/test", "POST", values);
      return outcome.ok
        ? {
            ok: true,
            detail: `${outcome.server} · ${outcome.tools.length} outil(s) : ${outcome.tools.map((t) => t.name).join(", ")}`,
            seconds: outcome.seconds,
          }
        : outcome;
    },
    save: async (values) => {
      await send(`api/connections/mcp/${values.id}`, "PUT", values);
      rerender();
    },
  });
  return section;
}

export function renderServices(container, services, { onSaved, rerender }) {
  container.replaceChildren(
    ragSection(services.rag, onSaved),
    searchSection(services.search, onSaved),
    claudeSection(services.claude, onSaved),
    mcpSection(services.mcp, rerender),
  );
}
