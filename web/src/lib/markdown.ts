// Rendu des réponses écrites : Markdown → HTML nettoyé, code coloré avec bouton Copier,
// liens externes signalés « à vérifier » (port de frontend/render.js). FORBID_ATTR
// style : la CSP bloque déjà l'attribut, on évite ainsi la violation remontée.
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import nginx from "highlight.js/lib/languages/nginx";
import powershell from "highlight.js/lib/languages/powershell";
import { Marked } from "marked";

hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("nginx", nginx);
hljs.registerLanguage("powershell", powershell);

const EXTERNAL_TITLE =
  "Lien cité de mémoire par l'IA (sans accès à Internet) : à vérifier";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function tagsHtml(text: string): string {
  const tags = [
    ...new Set(
      text
        .split(/[,\n]/)
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean),
    ),
  ].slice(0, 8);
  const buttons = tags.map(
    (tag) =>
      `<button type="button" class="tag" data-tag="${escapeHtml(tag)}" ` +
      `title="Chercher « ${escapeHtml(tag)} » sur internet">#${escapeHtml(tag)}</button>`,
  );
  return `<div class="tags"><span class="tags__label">Mots-clés</span>${buttons.join("")}</div>`;
}

// Attributs style et gestionnaires on* du HTML brut retirés avant DOMPurify : Chromium
// signale sinon une violation CSP dès l'analyse, même si l'attribut est ensuite supprimé.
const INLINE_ATTRIBUTE =
  /\s(?:style|on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }) {
      return text.replace(INLINE_ATTRIBUTE, "");
    },
    code({ text, lang }) {
      const language = (lang ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      // Mots-clés d'une réponse issue d'une recherche web : cliquables
      if (language === "tags") return tagsHtml(text);
      const known = language ? hljs.getLanguage(language) : undefined;
      const body = known
        ? hljs.highlight(text, { language, ignoreIllegals: true }).value
        : escapeHtml(text);
      const label = known?.name ?? (language || "texte");
      return (
        `<div class="code"><div class="code__head"><span>${escapeHtml(label)}</span>` +
        `<button type="button" class="code__copy">Copier</button></div>` +
        `<pre><code class="hljs">${body}</code></pre></div>`
      );
    },
  },
});

// Liens : nouvel onglet, sans référent ; les liens Internet sont signalés « à vérifier »
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName !== "A") return;
  const href = node.getAttribute("href") ?? "";
  if (/^https?:\/\//i.test(href)) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
    node.classList.add("link--external");
    node.setAttribute("title", EXTERNAL_TITLE);
  }
});

export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }), {
    ADD_ATTR: ["target"],
    FORBID_TAGS: ["style", "form", "input", "img"],
    FORBID_ATTR: ["style"],
  });
}

// --- Réponse avec sources web (port de web.js) ----------------------------------

// Liste « Sources : » écrite par le modèle malgré la consigne : doublon du bloc affiché
function dropWrittenSources(root: ParentNode) {
  const heading = [...root.children]
    .reverse()
    .find((node) =>
      /^\s*(sources|références)\s*:?/i.test(node.textContent ?? ""),
    );
  if (!heading) return;
  let node: Element | null = heading;
  if (heading.previousElementSibling?.tagName === "HR")
    node = heading.previousElementSibling;
  while (node) {
    const next: Element | null = node.nextElementSibling;
    node.remove();
    node = next;
  }
}

// Renvois [1], [2] du texte -> liens vers la source correspondante
function linkCitations(root: DocumentFragment, prefix: string, count: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest("pre, code, a")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const parts = (node.textContent ?? "").split(/\[(\d{1,2})\]/);
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
      const link = document.createElement("a");
      link.className = "citation";
      link.textContent = String(n);
      link.href = `#${prefix}-${n}`;
      fragment.append(link);
    });
    node.replaceWith(fragment);
  }
}

// Réponse rendue puis adaptée aux sources web : doublon retiré, renvois cliquables
export function renderAnswer(
  text: string,
  web?: { prefix: string; count: number },
): string {
  const html = renderMarkdown(text);
  if (!web?.count) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  dropWrittenSources(template.content);
  linkCitations(template.content, web.prefix, web.count);
  return template.innerHTML;
}
