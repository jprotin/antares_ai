// eslint (plan 3.4) : règles de frontière (moteurs sans React) et de CSP (pas de HTML
// brut hors MarkdownView, pas d'attribut style posé par setAttribute).
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

const NO_RAW_HTML = {
  selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
  message:
    "HTML brut seulement dans MarkdownView.tsx (rendu nettoyé par lib/markdown).",
};
const NO_STYLE_ATTRIBUTE = {
  selector:
    "CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^style$/i]",
  message:
    "Attribut style bloqué par la CSP : utiliser el.style.setProperty (CSSOM).",
};
const NO_INNER_HTML = {
  selector: "AssignmentExpression[left.property.name=/^(inner|outer)HTML$/]",
  message:
    "HTML brut seulement par MarkdownView.tsx (rendu nettoyé par lib/markdown).",
};
const NO_HTML_SINKS = {
  selector:
    "CallExpression[callee.property.name=/^(insertAdjacentHTML|write|writeln|createContextualFragment)$/]",
  message: "Injection de HTML interdite : passer par MarkdownView.tsx.",
};

export default tseslint.config(
  {
    ignores: [
      "dist",
      "node_modules",
      "test-results",
      "playwright-report",
      "coverage",
      "src/components/ui",
    ],
  },
  {
    files: ["**/*.{js,mjs}"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
    rules: {
      eqeqeq: ["error", "always"],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "no-restricted-syntax": [
        "error",
        NO_RAW_HTML,
        NO_STYLE_ATTRIBUTE,
        NO_INNER_HTML,
        NO_HTML_SINKS,
      ],
    },
  },
  {
    // Remplaçant d'une bibliothèque (react-remove-scroll-bar) : mêmes exports qu'elle
    files: ["src/shims/**"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  {
    files: ["src/features/conversation/MarkdownView.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        NO_STYLE_ATTRIBUTE,
        NO_INNER_HTML,
        NO_HTML_SINKS,
      ],
    },
  },
  {
    files: ["src/lib/markdown.ts"],
    rules: {
      "no-restricted-syntax": ["error", NO_RAW_HTML, NO_STYLE_ATTRIBUTE],
    },
  },
  {
    // Moteurs impératifs : ni React, ni fonctionnalités
    files: ["src/engines/**/*.{ts,tsx,js}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "react/*"],
              message: "Pas de React dans les moteurs.",
            },
            {
              group: ["@/features/*", "**/features/**"],
              message: "Les moteurs n'importent pas les fonctionnalités.",
            },
          ],
        },
      ],
    },
  },
  {
    // Une fonctionnalité n'en importe une autre que par son index.ts
    files: ["src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@/features/[^/]+/(?!index$).+",
              message: "Importer une autre fonctionnalité par son index.ts.",
            },
            {
              // Relatif vers une fonctionnalité voisine : ../autre/... (hors index)
              regex: "^\\.\\./[^./][^/]*/(?!index$).+",
              message:
                "Importer une autre fonctionnalité par @/features/<nom>.",
            },
          ],
        },
      ],
    },
  },
  {
    // Specs : `test` vient de tests/support/test.ts (gardes hors ligne, CSP, écritures)
    files: ["tests/e2e/**/*.ts", "tests/perf/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@playwright/test",
              importNames: ["test"],
              message:
                "Importer test depuis ../support/test (gardes automatiques).",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "tests/**/*.ts",
      "scripts/**/*.mjs",
      "*.config.{ts,js}",
      "public/theme-init.js",
    ],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ["public/capture-worklet.js"],
    languageOptions: {
      globals: {
        AudioWorkletProcessor: "readonly",
        registerProcessor: "readonly",
        sampleRate: "readonly",
      },
    },
  },
);
