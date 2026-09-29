// Rendu des réponses écrites : Markdown → HTML nettoyé, code coloré avec bouton Copier,
// liens externes signalés « à vérifier » (cités de mémoire par le LLM, sans accès web).
// Bibliothèques servies localement (cf. vendor/README.md).

import { Marked } from "./vendor/marked.esm.js";
import DOMPurify from "./vendor/purify.es.js";
import hljs from "./vendor/highlight.min.js";
import dockerfile from "./vendor/languages/dockerfile.min.js";
import nginx from "./vendor/languages/nginx.min.js";
import powershell from "./vendor/languages/powershell.min.js";

hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("nginx", nginx);
hljs.registerLanguage("powershell", powershell);

const EXTERNAL_TITLE =
  "Lien cité de mémoire par l'IA (sans accès à Internet) : à vérifier";

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }) {
      const language = (lang ?? "").trim().split(/\s+/)[0].toLowerCase();
      const known = language && hljs.getLanguage(language);
      const body = known
        ? hljs.highlight(text, { language, ignoreIllegals: true }).value
        : escapeHtml(text);
      const label = known
        ? hljs.getLanguage(language).name
        : language || "texte";
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

export function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(text), {
    ADD_ATTR: ["target"],
    FORBID_TAGS: ["style", "form", "input", "img"],
  });
}

// Mise à jour au fil du flux, limitée à une fois par image affichée
const pending = new Map();
export function renderInto(element, text) {
  const first = !pending.has(element);
  pending.set(element, text);
  if (!first) return;
  requestAnimationFrame(() => {
    element.innerHTML = renderMarkdown(pending.get(element));
    pending.delete(element);
  });
}

// Secours si l'API presse-papiers est refusée (permissions, contexte non sécurisé)
function copyWithSelection(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  return copied;
}

// Boutons Copier (délégation : les blocs de code sont recréés à chaque rendu)
export function enableCodeCopy(container) {
  container.addEventListener("click", async (event) => {
    const button = event.target.closest(".code__copy");
    if (!button) return;
    const code =
      button.closest(".code")?.querySelector("code")?.innerText ?? "";
    try {
      await navigator.clipboard.writeText(code);
      button.textContent = "Copié";
    } catch {
      button.textContent = copyWithSelection(code)
        ? "Copié"
        : "Copie impossible";
    }
    setTimeout(() => (button.textContent = "Copier"), 1500);
  });
}
