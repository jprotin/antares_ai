// Recherche web : pictogramme de connexion Internet, statut « Je cherche sur
// internet… » pendant une recherche, sources numérotées et cliquables sous la réponse.

import { tagsHtml } from "./render.js";
import { getJson } from "./settings.js";

const POLL_MS = 15000;
const SEARCH_POLL_MS = 600;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export const net = { online: null };

// Pictogramme : connecté / hors ligne ; `onChange` quand l'état bascule
export function initNet({ indicator, onChange }) {
  const label = indicator.querySelector(".net__label");
  async function poll() {
    let state;
    try {
      state = await getJson("api/net");
    } catch {
      return;
    }
    const changed = state.online !== net.online;
    net.online = state.online;
    indicator.classList.toggle("net--offline", !state.online);
    label.textContent = state.online ? "Internet" : "Hors ligne";
    indicator.title = state.online
      ? `Connecté à Internet : recherche web ${state.search ? "disponible" : "indisponible (SearXNG ne répond pas)"}, modèles Claude disponibles`
      : "Pas de connexion à Internet : pas de recherche web, modèles locaux seulement";
    if (changed && net.online !== null) onChange(state.online);
  }
  poll();
  window.setInterval(poll, POLL_MS);
}

// Pendant la réflexion : signale une recherche web en cours ; renvoie l'arrêt
export function watchSearch(onSearching) {
  let active = true;
  let shown = false;
  (async () => {
    while (active) {
      try {
        const { searching } = await getJson("api/net");
        if (searching !== shown && active) {
          shown = searching;
          onSearching(searching);
        }
      } catch {
        return;
      }
      await new Promise((resolve) =>
        window.setTimeout(resolve, SEARCH_POLL_MS),
      );
    }
  })();
  return () => {
    active = false;
  };
}

// Renvois [1], [2] du texte -> liens vers la source correspondante
function linkCitations(root, prefix, count) {
  const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement.closest("pre, code, a")
        ? window.NodeFilter.FILTER_REJECT
        : window.NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const parts = node.textContent.split(/\[(\d{1,2})\]/);
    if (parts.length === 1) continue;
    const fragment = document.createDocumentFragment();
    parts.forEach((part, index) => {
      if (index % 2 === 0) {
        if (part) fragment.append(part);
        return;
      }
      const n = Number(part);
      if (n < 1 || n > count) {
        fragment.append(`[${part}]`);
        return;
      }
      const link = element("a", "citation", String(n));
      link.href = `#${prefix}-${n}`;
      fragment.append(link);
    });
    node.replaceWith(fragment);
  }
}

// Liste « Sources : » écrite par le modèle malgré la consigne : doublon du bloc affiché
function dropWrittenSources(text) {
  const heading = [...text.children]
    .reverse()
    .find((node) => /^\s*(sources|références)\s*:?/i.test(node.textContent));
  if (!heading) return;
  let node = heading;
  if (heading.previousElementSibling?.tagName === "HR") {
    node = heading.previousElementSibling;
  }
  while (node) {
    const next = node.nextElementSibling;
    node.remove();
    node = next;
  }
}

// Mots-clés demandés au modèle local une fois la réponse affichée
async function showTags(block, web, answer) {
  try {
    const { tags } = await getJson("api/web/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: web.query, answer }),
    });
    if (tags.length)
      block.insertAdjacentHTML("afterend", tagsHtml(tags.join(", ")));
  } catch (error) {
    console.warn("Mots-clés indisponibles", error);
  }
}

// Bloc « Sources (web) » sous la réponse
export function showWebSources(line, web) {
  if (!web?.sources?.length || line.querySelector(".web-sources")) return;
  const prefix = `src-${line.dataset.item ?? Date.now()}`.replace(
    /[^\w-]/g,
    "",
  );
  const block = element("section", "web-sources");
  const head = element("div", "web-sources__head");
  head.append(
    element("strong", "", "Sources"),
    element("span", "badge badge--cloud", "web"),
    element("span", "web-sources__query", `« ${web.query} »`),
  );
  const list = element("ol", "web-sources__list");
  for (const source of web.sources) {
    const item = element("li", "web-source");
    item.id = `${prefix}-${source.n}`;
    const title = element("a", "web-source__title", source.title);
    title.href = source.url;
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    item.append(
      element("span", "web-source__n", String(source.n)),
      title,
      element("span", "web-source__domain", source.domain),
    );
    if (source.snippet) {
      item.append(element("p", "web-source__snippet", source.snippet));
    }
    list.append(item);
  }
  block.append(head, list);
  const text = line.querySelector(".line__text");
  dropWrittenSources(text);
  linkCitations(text, prefix, web.sources.length);
  (line.querySelector(".line__code") ?? text).after(block);
  showTags(block, web, text.innerText);
}
