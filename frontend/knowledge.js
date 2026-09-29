// Fiches de connaissance : le LLM rédige une fiche depuis la conversation ou un document
// joint, l'utilisateur la relit et la corrige, choisit les fiches qu'elle remplace, puis
// l'indexe dans le RAG. Panneau Connaissances : fiches par projet, obsolescence, retrait.

import { closeOnBackdrop, getJson, profile } from "./settings.js";

const STATES = { active: "active", expired: "expirée", obsolete: "obsolète" };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function projectOptions(select, selected) {
  const projects = await getJson("api/projects").catch(() => []);
  select.replaceChildren(
    Object.assign(element("option", "", "Commun (tous projets)"), {
      value: "",
    }),
    ...projects.map((p) =>
      Object.assign(element("option", "", p.id), { value: p.id }),
    ),
  );
  select.value = projects.some((p) => p.id === selected) ? selected : "";
}

export function initKnowledge({ notify, historyFor }) {
  const editor = document.getElementById("knowledge-edit");
  const form = document.getElementById("knowledge-form");
  const fields = {
    title: document.getElementById("knowledge-title"),
    project: document.getElementById("knowledge-project"),
    body: document.getElementById("knowledge-body"),
    tags: document.getElementById("knowledge-tags"),
    validUntil: document.getElementById("knowledge-until"),
  };
  const similarList = document.getElementById("knowledge-similar");
  const status = document.getElementById("knowledge-status");
  const save = document.getElementById("knowledge-save");
  const panel = document.getElementById("knowledge-panel");
  const cardsList = document.getElementById("knowledge-cards");
  let current = null;

  function showSimilar(similar) {
    similarList.replaceChildren();
    if (!similar.length) {
      similarList.append(
        element("p", "settings__hint", "Aucune fiche proche dans ce projet."),
      );
      return;
    }
    similarList.append(
      element(
        "p",
        "settings__hint",
        "Fiches proches déjà indexées : cochez celles que celle-ci remplace (elles deviendront obsolètes).",
      ),
    );
    for (const card of similar) {
      const label = element("label", "option");
      const box = Object.assign(element("input"), {
        type: "checkbox",
        value: card.id,
      });
      const text = element("span");
      text.append(
        element("span", "option__title", card.title),
        element(
          "span",
          "option__detail",
          `similarité ${card.score} · ${new Date(card.created * 1000).toLocaleDateString("fr-FR")}`,
        ),
      );
      label.append(box, text, element("span"));
      similarList.append(label);
    }
  }

  async function open(source) {
    current = null;
    status.textContent = "Rédaction de la fiche par le modèle…";
    status.classList.remove("settings__error");
    form.hidden = true;
    save.disabled = true;
    editor.showModal();
    const project = profile.settings?.project ?? "";
    try {
      const result = await getJson("api/knowledge/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...source, project }),
      });
      current = result.draft;
      fields.title.value = current.title;
      fields.body.value = current.body;
      fields.tags.value = (current.tags || []).join(", ");
      fields.validUntil.value = current.valid_until || "";
      await projectOptions(fields.project, current.project);
      showSimilar(result.similar);
      status.textContent = result.cut
        ? "Source longue : fiche rédigée à partir des 60 000 premiers caractères."
        : `Source : ${current.source.name}. Relisez et corrigez avant d'indexer.`;
      form.hidden = false;
      save.disabled = false;
    } catch (error) {
      status.textContent = `Fiche impossible : ${error.message}`;
      status.classList.add("settings__error");
    }
  }

  // Changer de projet : les fiches proches se cherchent dans le nouveau projet
  fields.project.addEventListener("change", async () => {
    const similar = await getJson("api/knowledge/similar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: fields.title.value,
        body: fields.body.value,
        project: fields.project.value,
      }),
    }).catch(() => []);
    showSimilar(similar);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    save.disabled = true;
    const replaces = [...similarList.querySelectorAll("input:checked")].map(
      (box) => box.value,
    );
    try {
      const card = await getJson("api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          card: {
            ...current,
            title: fields.title.value,
            body: fields.body.value,
            tags: fields.tags.value
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
            valid_until: fields.validUntil.value || null,
            project: fields.project.value,
          },
          replaces,
        }),
      });
      editor.close();
      notify(
        `Fiche indexée : ${card.title} (${card.project || "commun"})` +
          (replaces.length
            ? ` — ${replaces.length} fiche(s) remplacée(s)`
            : ""),
      );
    } catch (error) {
      status.textContent = `Indexation impossible : ${error.message}`;
      status.classList.add("settings__error");
      save.disabled = false;
    }
  });

  document
    .getElementById("knowledge-cancel")
    .addEventListener("click", () => editor.close());
  closeOnBackdrop(editor);

  // Panneau Connaissances
  async function renderCards() {
    const { enabled, cards } = await getJson("api/knowledge");
    cardsList.replaceChildren();
    if (!enabled) {
      cardsList.append(
        element(
          "p",
          "settings__error",
          "Indexation désactivée : RAG_WRITE_TOKEN absent d'ai-to-boost (relancer install.sh).",
        ),
      );
    }
    if (!cards.length) {
      cardsList.append(
        element(
          "p",
          "agents__empty",
          "Aucune fiche pour l'instant. Utilisez « Proposer au RAG » sur une conversation ou un document.",
        ),
      );
      return;
    }
    const projects = [...new Set(cards.map((c) => c.project))].sort();
    for (const project of projects) {
      const group = element("section", "agents__group");
      group.append(element("h3", "", project || "Commun"));
      for (const card of cards.filter((c) => c.project === project)) {
        const item = element("article", "agent-card");
        const head = element("div", "agent-card__head");
        head.append(
          element("span", "option__title", card.title),
          element(
            "span",
            `badge badge--${card.state === "active" ? "gpu" : "unknown"}`,
            STATES[card.state],
          ),
        );
        const meta = [
          new Date(card.updated * 1000).toLocaleDateString("fr-FR"),
          card.source?.name && `source : ${card.source.name}`,
          card.valid_until && `valable jusqu'au ${card.valid_until}`,
        ].filter(Boolean);
        const actions = element("div", "agent-card__actions");
        if (card.state !== "obsolete") {
          const retire = element("button", "preview-button", "Obsolète");
          retire.type = "button";
          retire.addEventListener("click", async () => {
            await getJson(`api/knowledge/${card.id}/obsolete`, {
              method: "POST",
            });
            renderCards();
          });
          actions.append(retire);
        }
        const remove = element("button", "preview-button", "Supprimer");
        remove.type = "button";
        remove.addEventListener("click", async () => {
          if (!window.confirm(`Supprimer la fiche « ${card.title} » ?`)) return;
          await fetch(`api/knowledge/${card.id}`, { method: "DELETE" });
          renderCards();
        });
        actions.append(remove);
        item.append(
          head,
          actions,
          element("p", "option__detail", meta.join(" · ")),
        );
        group.append(item);
      }
      cardsList.append(group);
    }
  }

  document
    .getElementById("open-knowledge")
    .addEventListener("click", async () => {
      panel.showModal();
      try {
        await renderCards();
      } catch (error) {
        cardsList.replaceChildren(
          element("p", "settings__error", error.message),
        );
      }
    });
  document
    .getElementById("knowledge-close")
    .addEventListener("click", () => panel.close());
  closeOnBackdrop(panel);

  document.getElementById("propose-knowledge").addEventListener("click", () => {
    const messages = historyFor();
    if (!messages.length) {
      notify("Rien à proposer : la conversation est vide.", true);
      return;
    }
    open({ messages });
  });

  return {
    fromDocument(documentId) {
      open({ document_id: documentId });
    },
  };
}
