// Projets du RAG intégré : documentation déposée ici (Markdown, texte, code, PDF, Word),
// découpée et indexée par le service rag d'antares. Réservé au mode « RAG intégré » des
// Connexions : le RAG d'ai-to-boost s'alimente par ses propres outils.

import { closeOnBackdrop, getJson } from "./settings.js";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Même règle que le routeur (ragstore.project_id) : « Mon Appli » -> « mon-appli »
function projectId(name) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 64);
}

export function initRagProjects({ onChanged }) {
  const dialog = document.getElementById("rag-projects");
  const select = document.getElementById("rag-project");
  const newName = document.getElementById("rag-project-new");
  const files = document.getElementById("rag-files");
  const add = document.getElementById("rag-add");
  const drop = document.getElementById("rag-drop");
  const status = document.getElementById("rag-status");
  const error = document.getElementById("rag-projects-error");
  const list = document.getElementById("rag-documents");
  let changed = false;

  function setStatus(text, failed = false) {
    status.classList.toggle("settings__error", failed);
    status.classList.toggle("settings__hint", !failed);
    status.textContent = text;
  }

  function target() {
    return projectId(newName.value) || select.value;
  }

  async function renderProjects(selected) {
    const projects = await getJson("api/projects");
    select.replaceChildren(
      ...projects.map((p) => {
        const option = element("option", "", `${p.id} (${p.chunks} extraits)`);
        option.value = p.id;
        return option;
      }),
    );
    if (!projects.length) {
      select.append(element("option", "", "Aucun projet : en créer un"));
      select.lastChild.value = "";
    }
    if (selected && projects.some((p) => p.id === selected)) {
      select.value = selected;
    }
    drop.disabled = !select.value;
    await renderDocuments();
  }

  async function renderDocuments() {
    const project = select.value;
    if (!project) {
      list.replaceChildren();
      return;
    }
    const docs = await getJson(`api/rag/projects/${project}/documents`);
    list.replaceChildren(
      ...docs.map((doc) => {
        const card = element("article", "agent-card");
        const head = element("div", "agent-card__head");
        head.append(element("span", "option__title", doc.source));
        const detail = element(
          "p",
          "option__detail",
          [doc.kind, `${doc.chunks} extrait(s)`].filter(Boolean).join(" · "),
        );
        const actions = element("div", "agent-card__actions");
        const remove = element("button", "preview-button", "Retirer");
        remove.type = "button";
        remove.addEventListener("click", async () => {
          if (!window.confirm(`Retirer « ${doc.source} » de ${project} ?`)) {
            return;
          }
          const response = await fetch(
            `api/rag/projects/${project}/documents/${encodeURIComponent(doc.id)}`,
            { method: "DELETE" },
          );
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            setStatus(body.detail ?? `HTTP ${response.status}`, true);
            return;
          }
          changed = true;
          await renderProjects(project);
        });
        actions.append(remove);
        card.append(head, detail, actions);
        return card;
      }),
    );
  }

  async function upload(project, file, index, total) {
    setStatus(`Indexation de ${file.name} (${index}/${total})…`);
    const response = await fetch(`api/rag/projects/${project}/documents`, {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-Filename": encodeURIComponent(file.name),
      },
      body: file,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        body.detail ??
          (response.status === 413
            ? `${file.name} : fichier trop volumineux (15 Mo au maximum)`
            : `${file.name} : HTTP ${response.status}`),
      );
    }
    return body;
  }

  add.addEventListener("click", () => {
    if (!target()) {
      setStatus("Choisir un projet ou saisir le nom d'un nouveau projet", true);
      return;
    }
    files.click();
  });

  files.addEventListener("change", async () => {
    const project = target();
    const chosen = [...files.files];
    files.value = "";
    if (!chosen.length) return;
    add.disabled = true;
    const failures = [];
    let chunks = 0;
    for (const [i, file] of chosen.entries()) {
      try {
        chunks += (await upload(project, file, i + 1, chosen.length)).chunks;
        changed = true;
      } catch (err) {
        failures.push(err.message);
      }
    }
    add.disabled = false;
    newName.value = "";
    const done = chosen.length - failures.length;
    setStatus(
      `${done} document(s) indexé(s) dans ${project} (${chunks} extraits)` +
        (failures.length ? ` — échecs : ${failures.join(" ; ")}` : ""),
      failures.length > 0,
    );
    await renderProjects(project).catch((err) => setStatus(err.message, true));
  });

  select.addEventListener("change", () => {
    drop.disabled = !select.value;
    renderDocuments().catch((err) => setStatus(err.message, true));
  });

  drop.addEventListener("click", async () => {
    const project = select.value;
    if (
      !project ||
      !window.confirm(
        `Supprimer le projet « ${project} » et toute sa documentation indexée ?`,
      )
    ) {
      return;
    }
    const response = await fetch(`api/rag/projects/${project}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setStatus(body.detail ?? `HTTP ${response.status}`, true);
      return;
    }
    changed = true;
    setStatus(`Projet ${project} supprimé`);
    await renderProjects();
  });

  function close() {
    dialog.close();
    if (changed) onChanged();
    changed = false;
  }
  document
    .getElementById("rag-projects-close")
    .addEventListener("click", close);
  closeOnBackdrop(dialog, close);

  document
    .getElementById("open-rag-projects")
    .addEventListener("click", async () => {
      error.textContent = "";
      setStatus("");
      list.replaceChildren();
      dialog.showModal();
      try {
        const { services } = await getJson("api/connections");
        const integrated = services.rag.mode === "integrated";
        for (const control of [select, newName, add, drop]) {
          control.disabled = !integrated;
        }
        if (!integrated) {
          error.textContent =
            "Disponible avec le RAG intégré : Connexions → RAG → « RAG intégré à antares ».";
          return;
        }
        await renderProjects(select.value);
      } catch (err) {
        error.textContent = err.message;
      }
    });
}
