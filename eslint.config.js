// Règles essentielles écrites en dur : l'environnement pre-commit ne fournit que
// le paquet eslint (pas @eslint/js).
const essentialRules = {
  "no-undef": "error",
  "no-unused-vars": "error",
  "no-unreachable": "error",
  "no-dupe-keys": "error",
  "no-redeclare": "error",
  "no-constant-condition": "error",
  "no-empty": "error",
  eqeqeq: ["error", "always"],
};

const browserGlobals = Object.fromEntries(
  [
    "window",
    "document",
    "navigator",
    "location",
    "performance",
    "console",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "matchMedia",
    "ResizeObserver",
    "fetch",
    "WebSocket",
    "AudioContext",
    "AudioWorkletNode",
    "CSS",
    "atob",
    "btoa",
    "FormData",
    "localStorage",
    "TextDecoder",
    "setTimeout",
    "Image",
  ].map((name) => [name, "readonly"]),
);

const audioWorkletGlobals = Object.fromEntries(
  ["AudioWorkletProcessor", "registerProcessor", "sampleRate"].map((name) => [
    name,
    "readonly",
  ]),
);

export default [
  {
    files: ["frontend/**/*.js"],
    rules: essentialRules,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: browserGlobals,
    },
  },
  {
    files: ["frontend/capture-worklet.js"],
    languageOptions: { globals: audioWorkletGlobals },
  },
];
