// Connexions : fournisseurs de modèles (Ollama, LiteLLM, API compatibles OpenAI), puis
// services (RAG, recherche, Claude, MCP : cf. services.js).
// Les clés d'API restent côté routeur : l'interface ne sait que si une clé est définie.

import { renderServices } from "./services.js";
import { closeOnBackdrop, getJson } from "./settings.js";

const PLACEHOLDERS = {
  ollama: "http://ollama:11434",
  openai: "https://api.exemple.com/v1 (l'adresse inclut /v1)",
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function slug(text) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function initConnections({ onChanged }) {
  const dialog = document.getElementById("connections");
  const list = document.getElementById("providers-list");
  const form = document.getElementById("provider-form");
  const title = document.getElementById("provider-form-title");
  const result = document.getElementById("provider-result");
  const error = document.getElementById("connections-error");
  const fields = {
    name: document.getElementById("provider-name"),
    id: document.getElementById("provider-id"),
    type: document.getElementById("provider-type"),
    url: document.getElementById("provider-url"),
    key: document.getElementById("provider-key"),
    local: document.getElementById("provider-local"),
    enabled: document.getElementById("provider-enabled"),
    noReasoning: document.getElementById("provider-noreasoning"),
  };
  let reasoningTouched = false;
  let editing = null;
  let changed = false;

  function draft() {
    return {
      id: fields.id.value.trim(),
      name: fields.name.value.trim(),
      type: fields.type.value,
      url: fields.url.value.trim(),
      api_key: fields.key.value,
      local: fields.local.checked,
      enabled: fields.enabled.checked,
      no_reasoning: fields.noReasoning.checked,
      keep_key: true,
    };
  }

  // Premier mot : révèle un raisonnement silencieux ou un modèle trop lourd
  function firstTokenText(test) {
    const first = test.firstToken;
    if (!first) return "";
    if (first.error) return ` · 1er mot : échec (${first.error})`;
    let text = ` · 1er mot en ${first.seconds} s (${test.firstModel})`;
    if (first.reasoning) {
      text += ` — le modèle a réfléchi (${first.reasoning} tokens) : cocher « Couper le raisonnement »`;
    } else if (first.seconds > 5) {
      text +=
        " — lent : chargement du modèle, ou modèle trop gros pour la VRAM";
    }
    return text;
  }

  function showResult(test) {
    result.classList.toggle(
      "settings__error",
      !test.ok || Boolean(test.firstToken?.reasoning),
    );
    result.textContent = test.ok
      ? `Joignable en ${test.seconds} s : ${test.count} modèle(s)` +
        firstTokenText(test)
      : `Échec : ${test.error}`;
  }

  async function test(provider) {
    return getJson("api/connections/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(provider),
    });
  }

  async function render() {
    const { providers, status, defaultModel, services } =
      await getJson("api/connections");
    const defaultProvider = defaultModel.split("/")[0];
    renderServices(document.getElementById("services"), services, {
      onSaved: () => (changed = true),
      rerender: () => render(),
    });
    list.replaceChildren(
      ...providers.map((provider) => {
        const card = element("article", "agent-card");
        const head = element("div", "agent-card__head");
        const state = status[provider.id];
        head.append(
          element("span", "option__title", provider.name),
          element(
            "span",
            "badge badge--unknown",
            provider.type === "ollama" ? "Ollama" : "API OpenAI",
          ),
          element(
            "span",
            `badge ${provider.local ? "badge--gpu" : "badge--cloud"}`,
            provider.local ? "local" : "hors local",
          ),
        );
        if (!provider.enabled) {
          head.append(element("span", "badge badge--unknown", "inactif"));
        }
        const detail = [
          provider.url,
          `modèles : ${provider.id}/…`,
          provider.has_key ? "clé définie" : "",
          state?.error
            ? `injoignable (${state.error})`
            : state
              ? `${state.count} modèle(s)`
              : "",
        ].filter(Boolean);
        const status_ = element("p", "option__detail", detail.join(" · "));
        if (state?.error) status_.classList.add("settings__error");
        const actions = element("div", "agent-card__actions");
        const button = (label, handler) => {
          const node = element("button", "preview-button", label);
          node.type = "button";
          node.addEventListener("click", handler);
          actions.append(node);
          return node;
        };
        button("Tester", async (event) => {
          event.target.textContent = "…";
          const outcome = await test({
            ...provider,
            api_key: "",
            keep_key: true,
          });
          event.target.textContent = outcome.ok
            ? `OK · ${outcome.count}`
            : "Échec";
          error.classList.toggle("settings__hint", outcome.ok);
          error.textContent = outcome.ok
            ? `${provider.name} : ${outcome.count} modèle(s)${firstTokenText(outcome)}`
            : `${provider.name} : ${outcome.error}`;
        });
        button("Modifier", () => openForm(provider));
        if (provider.id !== defaultProvider) {
          button("Supprimer", async () => {
            if (
              !window.confirm(`Supprimer le fournisseur « ${provider.name} » ?`)
            ) {
              return;
            }
            await fetch(`api/connections/providers/${provider.id}`, {
              method: "DELETE",
            });
            changed = true;
            render();
          });
        }
        card.append(head, status_, actions);
        return card;
      }),
    );
  }

  function openForm(provider) {
    editing = provider;
    title.textContent = provider
      ? `Modifier « ${provider.name} »`
      : "Nouveau fournisseur";
    fields.name.value = provider?.name ?? "";
    fields.id.value = provider?.id ?? "";
    fields.id.disabled = Boolean(provider);
    fields.type.value = provider?.type ?? "openai";
    fields.url.value = provider?.url ?? "";
    fields.url.placeholder = PLACEHOLDERS[fields.type.value];
    fields.key.value = "";
    fields.key.placeholder = provider?.has_key
      ? "••• définie (laisser vide pour la garder)"
      : "aucune";
    fields.local.checked = provider?.local ?? false;
    fields.enabled.checked = provider?.enabled ?? true;
    fields.noReasoning.checked = provider?.no_reasoning ?? fields.local.checked;
    reasoningTouched = Boolean(provider);
    result.textContent = "";
    error.textContent = "";
    form.hidden = false;
    fields.name.focus();
  }

  fields.name.addEventListener("input", () => {
    if (!editing) fields.id.value = slug(fields.name.value);
  });
  // Nouveau fournisseur : la coupure du raisonnement suit « local » tant qu'on n'y touche pas
  fields.local.addEventListener("change", () => {
    if (!reasoningTouched) fields.noReasoning.checked = fields.local.checked;
  });
  fields.noReasoning.addEventListener(
    "change",
    () => (reasoningTouched = true),
  );
  fields.type.addEventListener("change", () => {
    fields.url.placeholder = PLACEHOLDERS[fields.type.value];
  });

  document
    .getElementById("provider-test")
    .addEventListener("click", async () => {
      result.textContent = "Test en cours…";
      try {
        showResult(await test(draft()));
      } catch (err) {
        showResult({ ok: false, error: err.message });
      }
    });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const provider = draft();
    try {
      await getJson(`api/connections/providers/${provider.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(provider),
      });
      form.hidden = true;
      changed = true;
      await render();
    } catch (err) {
      result.classList.add("settings__error");
      result.textContent = err.message;
    }
  });

  document
    .getElementById("provider-cancel")
    .addEventListener("click", () => (form.hidden = true));
  document
    .getElementById("provider-new")
    .addEventListener("click", () => openForm(null));

  function close() {
    dialog.close();
    if (changed) onChanged();
    changed = false;
  }
  document.getElementById("connections-close").addEventListener("click", close);
  closeOnBackdrop(dialog, close);

  document
    .getElementById("open-connections")
    .addEventListener("click", async () => {
      form.hidden = true;
      error.textContent = "";
      dialog.showModal();
      try {
        await render();
      } catch (err) {
        error.textContent = err.message;
      }
    });
}
