// Panneau Agents : fiches « consignes » regroupées par domaine, filtrables par utilité.
// Les fiches sont stockées par le routeur LLM (/api/agents).

import { closeOnBackdrop, getJson, modelLabel } from "./settings.js";

const EXAMPLE_INSTRUCTIONS =
  "Ex. : Tu es un expert Kubernetes. Demande d'abord le symptôme et la sortie de " +
  "kubectl describe. Propose une hypothèse à la fois avec la commande pour la vérifier.";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fillDatalist(list, values) {
  list.replaceChildren(
    ...values.map((value) => Object.assign(element("option"), { value })),
  );
}

function fillSelect(select, entries, selected) {
  select.replaceChildren(
    ...entries.map(([value, label]) =>
      Object.assign(element("option", "", label), {
        value,
        selected: value === selected,
      }),
    ),
  );
}

export function initAgentsDialog({ onChanged }) {
  const dialog = document.getElementById("agents");
  const list = document.getElementById("agents-list");
  const filter = document.getElementById("agents-filter");
  const form = document.getElementById("agent-form");
  const title = document.getElementById("agent-form-title");
  const error = document.getElementById("agents-error");
  const fields = {
    name: document.getElementById("agent-name"),
    domain: document.getElementById("agent-domain"),
    usage: document.getElementById("agent-usage"),
    description: document.getElementById("agent-description"),
    instructions: document.getElementById("agent-instructions"),
    project: document.getElementById("agent-project"),
    model: document.getElementById("agent-model"),
  };
  fields.instructions.placeholder = EXAMPLE_INSTRUCTIONS;
  let agents = [];
  let editing = null;

  function renderList() {
    const usage = filter.value;
    const shown = agents.filter((agent) => !usage || agent.usage === usage);
    if (!shown.length) {
      list.replaceChildren(
        element("p", "agents__empty", "Aucun agent pour ce filtre."),
      );
      return;
    }
    const domains = [...new Set(shown.map((agent) => agent.domain))].sort();
    list.replaceChildren(
      ...domains.map((domain) => {
        const group = element("section", "agents__group");
        group.append(element("h3", "", domain));
        for (const agent of shown.filter((a) => a.domain === domain)) {
          const card = element("article", "agent-card");
          const head = element("div", "agent-card__head");
          head.append(
            element("span", "option__title", agent.name),
            element("span", "badge badge--unknown", agent.usage),
          );
          const extras = [
            agent.project && `projet ${agent.project}`,
            agent.model && modelLabel(agent.model),
          ].filter(Boolean);
          const detail = element(
            "p",
            "option__detail",
            [agent.description, ...extras].filter(Boolean).join(" · "),
          );
          const actions = element("div", "agent-card__actions");
          const edit = element("button", "preview-button", "Modifier");
          edit.type = "button";
          edit.addEventListener("click", () => openForm(agent));
          const remove = element("button", "preview-button", "Supprimer");
          remove.type = "button";
          remove.addEventListener("click", () => removeAgent(agent));
          actions.append(edit, remove);
          card.append(head, detail, actions);
          group.append(card);
        }
        return group;
      }),
    );
  }

  async function refresh() {
    const [loaded, meta, projects, models] = await Promise.all([
      getJson("api/agents"),
      getJson("api/agents/meta"),
      getJson("api/projects").catch(() => []),
      getJson("api/models").catch(() => []),
    ]);
    agents = loaded;
    // Listes proposées + valeurs personnelles déjà utilisées
    const domains = [
      ...new Set([...meta.domains, ...agents.map((a) => a.domain)]),
    ];
    const usages = [
      ...new Set([...meta.usages, ...agents.map((a) => a.usage)]),
    ];
    fillDatalist(document.getElementById("agent-domains"), domains);
    fillDatalist(document.getElementById("agent-usages"), usages);
    const current = filter.value;
    fillSelect(
      filter,
      [["", "Toutes les utilités"], ...usages.map((u) => [u, u])],
      current,
    );
    fillSelect(
      fields.project,
      [["", "Aucun"], ...projects.map((p) => [p.id, p.id])],
      "",
    );
    fillSelect(
      fields.model,
      [
        ["", "Modèle choisi dans les Réglages"],
        ...models.map((m) => [m.name, m.label ?? m.name]),
      ],
      "",
    );
    renderList();
  }

  function openForm(agent) {
    editing = agent;
    title.textContent = agent ? `Modifier « ${agent.name} »` : "Nouvel agent";
    for (const [key, input] of Object.entries(fields)) {
      input.value = agent?.[key] ?? "";
    }
    error.textContent = "";
    form.hidden = false;
    fields.name.focus();
  }

  async function removeAgent(agent) {
    if (!window.confirm(`Supprimer l'agent « ${agent.name} » ?`)) return;
    try {
      await fetch(`api/agents/${encodeURIComponent(agent.id)}`, {
        method: "DELETE",
      });
      await refresh();
      onChanged();
    } catch (err) {
      error.textContent = err.message;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const draft = Object.fromEntries(
      Object.entries(fields).map(([key, input]) => [key, input.value.trim()]),
    );
    try {
      await getJson(
        editing ? `api/agents/${encodeURIComponent(editing.id)}` : "api/agents",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
      );
      form.hidden = true;
      await refresh();
      onChanged();
    } catch (err) {
      error.textContent = err.message;
    }
  });

  document
    .getElementById("agent-cancel")
    .addEventListener("click", () => (form.hidden = true));
  document
    .getElementById("agent-new")
    .addEventListener("click", () => openForm(null));
  document
    .getElementById("agents-close")
    .addEventListener("click", () => dialog.close());
  filter.addEventListener("change", renderList);
  closeOnBackdrop(dialog);

  document.getElementById("open-agents").addEventListener("click", async () => {
    form.hidden = true;
    error.textContent = "";
    dialog.showModal();
    try {
      await refresh();
    } catch (err) {
      error.textContent = `Agents indisponibles : ${err.message}`;
    }
  });
}
