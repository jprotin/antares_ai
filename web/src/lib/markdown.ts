// Rendu des réponses écrites : Markdown → HTML nettoyé, code coloré (port de
// frontend/render.js). FORBID_ATTR style : la CSP bloque déjà l'attribut, on évite
// ainsi la violation remontée.
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import nginx from "highlight.js/lib/languages/nginx";
import powershell from "highlight.js/lib/languages/powershell";
import { Marked } from "marked";

hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("nginx", nginx);
hljs.registerLanguage("powershell", powershell);

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
      const known = language ? hljs.getLanguage(language) : undefined;
      const body = known
        ? hljs.highlight(text, { language, ignoreIllegals: true }).value
        : escapeHtml(text);
      const label = known?.name ?? (language || "texte");
      return (
        `<div class="code"><div class="code__head"><span>${escapeHtml(label)}</span></div>` +
        `<pre><code class="hljs">${body}</code></pre></div>`
      );
    },
  },
});

export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }), {
    ADD_ATTR: ["target"],
    FORBID_TAGS: ["style", "form", "input", "img"],
    FORBID_ATTR: ["style"],
  });
}
