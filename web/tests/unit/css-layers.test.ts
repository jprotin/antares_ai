// Couches CSS (plan 2.9) : avec Tailwind v4, une règle hors @layer l'emporte sur tous
// les utilitaires. Toute instruction de premier niveau de src/**/*.css doit être une
// couche, une directive (@import, @property, @theme, @custom-variant…) ou un
// @media print qui n'enveloppe que des couches.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const ALLOWED =
  /^@(layer|import|property|theme|custom-variant|utility|source|plugin)\b/;

// Instructions de premier niveau : texte jusqu'au `;` ou au bloc `{…}` équilibré
export function topLevel(css: string): { head: string; body: string }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const statements: { head: string; body: string }[] = [];
  let index = 0;
  while (index < text.length) {
    const brace = text.indexOf("{", index);
    const semicolon = text.indexOf(";", index);
    if (brace < 0 && semicolon < 0) break;
    if (semicolon >= 0 && (brace < 0 || semicolon < brace)) {
      const head = text.slice(index, semicolon).trim();
      if (head) statements.push({ head, body: "" });
      index = semicolon + 1;
      continue;
    }
    let depth = 0;
    let end = brace;
    for (; end < text.length; end += 1) {
      if (text[end] === "{") depth += 1;
      else if (text[end] === "}" && --depth === 0) break;
    }
    statements.push({
      head: text.slice(index, brace).trim(),
      body: text.slice(brace + 1, end),
    });
    index = end + 1;
  }
  return statements;
}

export function outsideLayers(css: string): string[] {
  return topLevel(css)
    .filter(({ head, body }) => {
      if (ALLOWED.test(head)) return false;
      if (/^@media\s+print\b/.test(head))
        return topLevel(body).some((inner) => !/^@layer\b/.test(inner.head));
      return true;
    })
    .map(({ head }) => head);
}

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

describe("couches CSS", () => {
  test("test_outsideLayers_regle_hors_couche_signalee", () => {
    expect(
      outsideLayers(
        '@import "x.css";\n.orb { color: red }\n@layer components { .a { color: blue } }',
      ),
    ).toEqual([".orb"]);
  });

  test("test_outsideLayers_media_print_sans_couche_signale", () => {
    expect(outsideLayers("@media print { .bar { display: none } }")).toEqual([
      "@media print",
    ]);
    expect(
      outsideLayers(
        "@media print { @layer components { .bar { display: none } } }",
      ),
    ).toEqual([]);
  });

  test.each(cssFiles("src"))("test_%s_tout_en_couche", (file) => {
    expect(outsideLayers(readFileSync(file, "utf8"))).toEqual([]);
  });
});
