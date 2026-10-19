// Tests de bout en bout : la même suite vise l'ancienne interface (ANTARES_UI=legacy) ou
// la nouvelle (ANTARES_UI=next), celle que sert 127.0.0.1:8765 (cd deploy/s2s && ./ui.sh
// legacy | new). Une seule session s2s à la fois : workers 1.
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

const ui = process.env.ANTARES_UI === "next" ? "next" : "legacy";
const baseURL = process.env.ANTARES_URL ?? "http://127.0.0.1:8765/";
const question = fileURLToPath(
  new URL("./tests/fixtures/question-fr.wav", import.meta.url),
);

// Micro simulé (le fichier repart du début à chaque getUserMedia, vérifié au spike)
const fakeMic = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  `--use-file-for-fake-audio-capture=${question}%noloop`,
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
];

const common = {
  baseURL,
  bypassCSP: false,
  permissions: ["microphone"],
  viewport: { width: 1440, height: 900 },
  launchOptions: { args: fakeMic },
};

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  projects: [
    {
      name: "chromium-mock",
      testMatch: /e2e\/.*\.spec\.ts/,
      grep: /@mock/,
      use: { ...common, browserName: "chromium" },
    },
    {
      name: "chromium-live",
      testMatch: /e2e\/.*\.spec\.ts/,
      grep: /@live/,
      use: { ...common, browserName: "chromium" },
    },
    {
      name: "offline-strict",
      testMatch: /e2e\/.*\.spec\.ts/,
      grep: /@offline/,
      use: { ...common, browserName: "chromium" },
    },
    {
      name: "smoke",
      testMatch: /e2e\/smoke\.spec\.ts/,
      use: { ...common, browserName: "chromium" },
    },
    {
      name: "perf",
      testMatch: /perf\/.*\.spec\.ts/,
      timeout: 30 * 60_000,
      use: { ...common, browserName: "chromium" },
    },
  ],
  metadata: { ui },
});
