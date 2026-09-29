// Documents joints à la conversation : trombone ou glisser-déposer, étiquettes avec la
// taille estimée, retrait. Le texte est extrait et gardé par le routeur (documents.py),
// qui l'ajoute à chaque question, à l'écrit comme à l'oral.

const ACCEPT =
  ".pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.log,.json,.yaml,.yml,.xml,.html,.ini," +
  ".conf,.cfg,.toml,.py,.js,.ts,.sh,.sql,.php,.go,.rs,.java,.tf,.properties," +
  ".png,.jpg,.jpeg,.webp";
const KIND_LABELS = {
  pdf: "PDF",
  word: "Word",
  texte: "Texte",
  image: "Image",
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function size(tokens) {
  return tokens >= 1000
    ? `~${Math.round(tokens / 1000)} k tokens`
    : `~${tokens} tokens`;
}

export function initAttachments({
  list,
  button,
  input,
  dropZone,
  notify,
  onPropose,
}) {
  input.accept = ACCEPT;

  function chip(doc) {
    const item = element("li", "attachment");
    item.dataset.id = doc.id;
    item.append(
      element("span", "attachment__kind", KIND_LABELS[doc.kind] ?? doc.kind),
      element("span", "attachment__name", doc.name),
      element("span", "attachment__size", size(doc.tokens)),
    );
    if (!doc.voice) {
      const badge = element("span", "attachment__warn", "écrit seulement");
      badge.title =
        "Trop long pour la conversation orale : utilisé pour les réponses écrites";
      item.append(badge);
    }
    if (doc.kind !== "image" && onPropose) {
      const propose = element("button", "attachment__rag", "RAG");
      propose.type = "button";
      propose.title = `Proposer une fiche de connaissance à partir de ${doc.name}`;
      propose.addEventListener("click", () => onPropose(doc.id));
      item.append(propose);
    }
    const remove = element("button", "attachment__remove", "×");
    remove.type = "button";
    remove.title = `Retirer ${doc.name}`;
    remove.setAttribute("aria-label", `Retirer ${doc.name}`);
    remove.addEventListener("click", async () => {
      await fetch(`api/documents/${encodeURIComponent(doc.id)}`, {
        method: "DELETE",
      });
      item.remove();
      list.hidden = !list.children.length;
    });
    item.append(remove);
    return item;
  }

  function show(docs) {
    list.replaceChildren(...docs.map(chip));
    list.hidden = !docs.length;
  }

  async function upload(file) {
    const pending = element("li", "attachment attachment--pending");
    pending.append(
      element("span", "attachment__name", file.name),
      element("span", "attachment__size", "lecture…"),
    );
    list.append(pending);
    list.hidden = false;
    try {
      const response = await fetch("api/documents", {
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
              : `${file.name} : envoi impossible (HTTP ${response.status})`),
        );
      }
      pending.replaceWith(chip(body));
      notify(`Document joint : ${file.name}`, body);
    } catch (error) {
      pending.remove();
      list.hidden = !list.children.length;
      notify(error.message, null);
    }
  }

  async function uploadAll(files) {
    for (const file of files) await upload(file);
  }

  button.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    uploadAll([...input.files]);
    input.value = "";
  });

  let depth = 0;
  dropZone.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    depth += 1;
    dropZone.classList.add("is-dropping");
  });
  dropZone.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (!depth) dropZone.classList.remove("is-dropping");
  });
  dropZone.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
  });
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    depth = 0;
    dropZone.classList.remove("is-dropping");
    uploadAll([...(event.dataTransfer?.files ?? [])]);
  });

  return {
    async load() {
      const response = await fetch("api/documents", { cache: "no-store" });
      show(response.ok ? await response.json() : []);
    },
    async clear() {
      await fetch("api/documents", { method: "DELETE" });
      show([]);
    },
  };
}
