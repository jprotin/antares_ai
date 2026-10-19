// Règles eslint du plan 3.4 : tests négatifs sur des extraits placés dans src/
import { ESLint } from "eslint";
import { describe, expect, test } from "vitest";

const eslint = new ESLint();

async function rules(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map(
    (m) => `${m.ruleId}: ${m.message.split(" ")[0]}`,
  );
}

describe("règles eslint", () => {
  test("test_dangerouslySetInnerHTML_hors_MarkdownView_refuse", async () => {
    const code =
      "export function A({ html }: { html: string }) {\n  return <div dangerouslySetInnerHTML={{ __html: html }} />;\n}\n";
    expect(await rules(code, "src/features/x/A.tsx")).toEqual([
      "no-restricted-syntax: HTML",
    ]);
    expect(
      await rules(code, "src/features/conversation/MarkdownView.tsx"),
    ).toEqual([]);
  });

  test("test_setAttribute_style_refuse", async () => {
    const code =
      'export function paint(el: HTMLElement) {\n  el.setAttribute("style", "color: red");\n}\n';
    expect(await rules(code, "src/engines/x.ts")).toEqual([
      "no-restricted-syntax: Attribut",
    ]);
  });

  test("test_innerHTML_hors_markdown_refuse", async () => {
    const code =
      "export function fill(el: HTMLElement, html: string) {\n  el.innerHTML = html;\n}\n";
    expect(await rules(code, "src/features/x/fill.ts")).toEqual([
      "no-restricted-syntax: HTML",
    ]);
  });

  test("test_react_dans_un_moteur_refuse", async () => {
    const code =
      'import { useState } from "react";\nexport const s = useState;\n';
    expect(await rules(code, "src/engines/x.ts")).toEqual([
      "no-restricted-imports: 'react'",
    ]);
  });

  test("test_import_interne_d_une_autre_fonctionnalite_refuse", async () => {
    const code =
      'import { ThemeToggle } from "@/features/theme/ThemeToggle";\nexport const T = ThemeToggle;\n';
    expect(await rules(code, "src/features/settings/x.ts")).toEqual([
      "no-restricted-imports: '@/features/theme/ThemeToggle'",
    ]);
  });

  test.each([
    ['el.setAttribute("STYLE", "color: red");', "Attribut"],
    ["el.outerHTML = html;", "HTML"],
    ['el.insertAdjacentHTML("beforeend", html);', "Injection"],
    ["document.write(html);", "Injection"],
  ])("test_puits_html_et_style_%s_refuse", async (statement, word) => {
    const code = `export function f(el: HTMLElement, html: string) {\n  void html;\n  ${statement}\n}\n`;
    expect(await rules(code, "src/features/x/f.ts")).toEqual([
      `no-restricted-syntax: ${word}`,
    ]);
  });

  test("test_import_relatif_d_une_fonctionnalite_voisine_refuse", async () => {
    const code =
      'import { SettingsDialog } from "../settings/SettingsDialog";\nexport const S = SettingsDialog;\n';
    expect(await rules(code, "src/features/theme/x.ts")).toEqual([
      "no-restricted-imports: '../settings/SettingsDialog'",
    ]);
  });

  test("test_import_par_index_autorise", async () => {
    const code =
      'import { themeFeature } from "@/features/theme/index";\nexport const T = themeFeature;\n';
    expect(await rules(code, "src/features/settings/x.ts")).toEqual([]);
  });
});
