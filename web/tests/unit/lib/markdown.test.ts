// @vitest-environment jsdom
// lib/markdown.ts : mêmes protections que render.js, plus FORBID_ATTR style
import { describe, expect, test } from "vitest";

import { renderMarkdown } from "@/lib/markdown";

function render(text: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderMarkdown(text);
  return root;
}

describe("markdown", () => {
  test.each([
    ["<script>alert(1)</script>", "script"],
    ['<img src="x" onerror="alert(1)">', "img"],
    ["<form><input></form>", "form"],
    ["<style>body{}</style>", "style"],
  ])("test_renderMarkdown_%s_retire", (html, tag) => {
    expect(render(html).querySelector(tag)).toBeNull();
  });

  test("test_renderMarkdown_attributs_style_et_on_retires", () => {
    const root = render('<p style="color:red" onclick="x()">texte</p>');
    const paragraph = root.querySelector("p");
    expect(paragraph?.textContent).toBe("texte");
    expect(paragraph?.hasAttribute("style")).toBe(false);
    expect(paragraph?.hasAttribute("onclick")).toBe(false);
  });

  test("test_renderMarkdown_lien_externe_a_verifier", () => {
    const link = render("[doc](https://example.org/doc)").querySelector("a");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.classList.contains("link--external")).toBe(true);
    expect(link?.getAttribute("title")).toContain("à vérifier");
  });

  test("test_renderMarkdown_lien_relatif_inchange", () => {
    const link = render("[aide](aide.html)").querySelector("a");
    expect(link?.hasAttribute("target")).toBe(false);
    expect(link?.classList.contains("link--external")).toBe(false);
  });

  test.each(["nginx", "dockerfile", "powershell", "sql"])(
    "test_renderMarkdown_bloc_%s_colore_avec_copier",
    (language) => {
      const root = render(
        `\`\`\`${language}\nserver { listen 80; } FROM node RUN echo SELECT 1\n\`\`\``,
      );
      expect(root.querySelector('[class*="hljs-"]')).not.toBeNull();
      expect(root.querySelector(".code__copy")?.textContent).toBe("Copier");
    },
  );

  test("test_renderMarkdown_bloc_tags_boutons", () => {
    const buttons = render(
      "```tags\n#docker, nginx, docker\n```",
    ).querySelectorAll("button.tag");
    expect([...buttons].map((b) => b.getAttribute("data-tag"))).toEqual([
      "docker",
      "nginx",
    ]);
  });
});
