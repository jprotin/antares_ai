// Agents d'action : lancement d'une tâche (bouton « Lancer un agent ») et suivi dans la
// conversation. Les actions lancées à la voix (« lance l'agent… », confirmé par « oui »)
// apparaissent aussi : le routeur est interrogé régulièrement.

import { renderMarkdown } from "./render.js";
import { closeOnBackdrop, getJson, profile } from "./settings.js";

const POLL_MS = 5000;
const STATUS = {
  accepted: ["en attente", "badge--unknown"],
  running: ["en cours", "badge--slow"],
  done: ["terminé", "badge--gpu"],
  error: ["échec", "badge--unknown"],
};
const CHANGES = { A: "ajouté", M: "modifié", D: "supprimé", R: "renommé" };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function option(value, label) {
  return Object.assign(element("option", "", label), { value });
}

export function initActions({ lines, beforeAppend, onFinished }) {
  const dialog = document.getElementById("action-launch");
  const form = document.getElementById("action-form");
  const agentSelect = document.getElementById("action-agent");
  const projectSelect = document.getElementById("action-project");
  const detail = document.getElementById("action-agent-detail");
  const task = document.getElementById("action-task");
  const error = document.getElementById("action-error");
  const submit = document.getElementById("action-submit");
  const composerText = document.getElementById("composer-text");
  // id -> statut connu ; les actions déjà présentes au chargement ne sont pas affichées
  const known = new Map();
  let actionAgents = [];

  function card(action) {
    let node = lines.querySelector(`[data-action="${action.id}"]`);
    if (!node) {
      beforeAppend();
      node = element("article", "line action-card");
      node.dataset.action = action.id;
      lines.append(node);
    }
    const [label, badge] = STATUS[action.status] ?? [action.status, ""];
    const head = element("div", "action-card__head");
    head.append(
      element(
        "span",
        "option__title",
        `Agent ${action.agent} · ${action.project}`,
      ),
      element("span", `badge ${badge}`, label),
      element("span", "badge badge--cloud", "hors local"),
    );
    const parts = [head, element("p", "action-card__task", action.task)];
    if (action.status === "error") {
      parts.push(
        element("p", "settings__error", action.error || "échec du worker"),
      );
    }
    if (action.status === "done") {
      if (action.summary) {
        const summary = element("div", "action-card__summary line--rich");
        summary.innerHTML = renderMarkdown(action.summary);
        parts.push(summary);
      }
      if (action.files?.length) {
        const list = element("ul", "action-card__files");
        for (const file of action.files) {
          const item = element("li");
          item.append(
            element(
              "span",
              "badge badge--unknown",
              CHANGES[file.change] ?? file.change,
            ),
            element("code", "", file.path),
          );
          list.append(item);
        }
        parts.push(list);
      }
      parts.push(
        element(
          "p",
          "option__detail",
          action.changed
            ? `Branche ${action.branch} (depuis ${action.base}) : à relire puis fusionner, rien n'est poussé.`
            : "Aucun fichier modifié.",
        ),
      );
    }
    node.replaceChildren(...parts);
    lines.scrollTop = lines.scrollHeight;
  }

  async function poll(initial = false) {
    let actions;
    try {
      actions = await getJson("api/actions");
    } catch {
      return;
    }
    for (const action of actions) {
      const before = known.get(action.id);
      known.set(action.id, action.status);
      if (initial || before === action.status) continue;
      card(action);
      if (
        before !== undefined &&
        (action.status === "done" || action.status === "error")
      ) {
        onFinished(action);
      }
    }
  }

  function showDetail() {
    const agent = actionAgents.find((a) => a.id === agentSelect.value);
    detail.textContent = agent?.description ?? "";
    if (
      agent?.repo &&
      [...projectSelect.options].some((o) => o.value === agent.repo)
    ) {
      projectSelect.value = agent.repo;
    }
  }

  async function open() {
    error.textContent = "";
    submit.disabled = false;
    task.value = composerText.value.trim();
    actionAgents = (profile.agents ?? []).filter((a) => a.kind === "action");
    agentSelect.replaceChildren(
      ...actionAgents.map((a) => option(a.id, a.name)),
    );
    dialog.showModal();
    if (!actionAgents.length) {
      error.textContent =
        "Aucun agent d'action : créez-en un (type « Action ») dans le panneau Agents.";
      submit.disabled = true;
    }
    try {
      const { enabled, projects } = await getJson("api/actions/projects");
      projectSelect.replaceChildren(...projects.map((p) => option(p, p)));
      if (!enabled || !projects.length) {
        error.textContent = enabled
          ? "Le worker d'ai-to-boost ne répond pas ou n'a aucun projet."
          : "Agents d'action désactivés : AGENT_TOKEN absent (relancer install.sh).";
        submit.disabled = true;
      }
    } catch (err) {
      error.textContent = err.message;
      submit.disabled = true;
    }
    showDetail();
    task.focus();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    error.textContent = "";
    try {
      const action = await getJson("api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agentSelect.value,
          project: projectSelect.value,
          task: task.value.trim(),
        }),
      });
      known.set(action.id, action.status);
      card(action);
      if (composerText.value.trim() === task.value.trim())
        composerText.value = "";
      dialog.close();
    } catch (err) {
      error.textContent = err.message;
      submit.disabled = false;
    }
  });

  agentSelect.addEventListener("change", showDetail);
  document
    .getElementById("action-cancel")
    .addEventListener("click", () => dialog.close());
  document.getElementById("launch-action").addEventListener("click", open);
  closeOnBackdrop(dialog);

  poll(true);
  window.setInterval(() => {
    if (!document.hidden) poll();
  }, POLL_MS);
}
