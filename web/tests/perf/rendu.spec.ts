// Rendu (grille MD-4, AV-4) : durée de rendu d'une réponse écrite de 5 000 caractères et
// images par seconde de l'orbe et des avatars 3D (swiftshader, sans GPU : la mesure sous
// GPU réel reste manuelle). Référence dans tests/baseline/legacy.json (clé « rendu ») :
// UPDATE_BASELINE=1 la réécrit, sinon l'interface testée y est comparée.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import type { Page } from "@playwright/test";

import { MockApi } from "../support/mock-api";
import { expect, test } from "../support/test";

const BASELINE = new URL("../baseline/legacy.json", import.meta.url);
const RUNS = Number(process.env.RENDER_N ?? 10);
const FPS_SECONDS = Number(process.env.FPS_SECONDS ?? 5);
const AVATARS = ["orb", "face3d", "visor", "bender"] as const;
const END = "Fin du test de rendu.";
// Tolérances : durée de rendu (bruit de mesure), baisse d'images par seconde (grille)
const RENDER_TOLERANCE = 1.2;
// Exception accordée le 2026-10-19 (PARITY.md, note 8) : coût de React sur la nouvelle
// interface, +2,3 ms mesurés ; marge de 2,5 ms au-dessus de la référence
const NEXT_RENDER_EXCEPTION_MS = 2.5;
const FPS_DROP = 0.1;

type Render = { median: number; p90: number; n: number; chars: number };
type Rendu = {
  markdown5000: Render;
  fps: Record<string, number>;
  frameMs: Record<string, number>;
};

// Réponse Markdown variée (titres, listes, code coloré, tableau, liens) de 5 000 caractères
function markdown(): string {
  const block = [
    "## Étape de migration\n\n",
    "Texte avec **gras**, *italique*, `code` et un [lien](https://example.org).\n\n",
    "- premier point\n- deuxième point\n  - sous-point\n\n",
    "```nginx\nlocation / { root /srv; try_files $uri /index.html; }\n```\n\n",
    "```python\ndef total(values):\n    return sum(v * 2 for v in values)\n```\n\n",
    "| Colonne | Valeur |\n| --- | --- |\n| a | 1 |\n| b | 2 |\n\n",
  ].join("");
  let text = "";
  while (text.length < 5_000 - END.length) text += block;
  return `${text.slice(0, 5_000 - END.length - 2)}\n\n${END}`;
}

function sse(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((x, y) => x - y);
  const index = (sorted.length - 1) * q;
  const low = sorted[Math.floor(index)] ?? 0;
  const high = sorted[Math.ceil(index)] ?? low;
  return low + (high - low) * (index - Math.floor(index));
}

// t0 : réponse de /api/chat reçue ; t1 : dernière mutation du DOM qui affiche la fin
async function installRenderProbe(page: Page) {
  await page.addInitScript((end) => {
    const probe = { t0: 0, t1: 0 };
    (window as unknown as { __render: typeof probe }).__render = probe;
    const native = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await native(...args);
      if (String(args[0]).includes("api/chat")) probe.t0 = performance.now();
      return response;
    };
    new MutationObserver(() => {
      if (probe.t0 && document.body.textContent?.includes(end))
        probe.t1 ||= performance.now();
    }).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }, END);
}

async function measureRender(page: Page, ui: import("../adapters").UiAdapter) {
  const body = sse(markdown());
  await new MockApi(page)
    .on(/^POST \/api\/chat$/, (route) =>
      route.fulfill({ contentType: "text/event-stream", body }),
    )
    .install();
  await installRenderProbe(page);
  const durations: number[] = [];
  // Premier rendu exclu (chargement de highlight.js à froid)
  for (let run = 0; run <= RUNS; run += 1) {
    await ui.goto();
    await ui.sendText("Rendu de test");
    await expect(ui.lastAssistantLine()).toContainText(END);
    const { t0, t1 } = await page.evaluate(
      () =>
        (window as unknown as { __render: { t0: number; t1: number } })
          .__render,
    );
    if (run > 0) durations.push(t1 - t0);
  }
  return {
    median: quantile(durations, 0.5),
    p90: quantile(durations, 0.9),
    n: durations.length,
    chars: markdown().length,
  };
}

// Coût JS par image : durée des rappels requestAnimationFrame de la page (l'avatar dessine
// dans ces rappels). Les images par seconde plafonnent à 60 sous swiftshader ; ce coût, lui,
// distingue deux rendus.
async function installFrameProbe(page: Page) {
  await page.addInitScript(() => {
    const probe = { busy: 0, callbacks: 0 };
    (window as unknown as { __frames: typeof probe }).__frames = probe;
    const native = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      native((now) => {
        const start = performance.now();
        try {
          callback(now);
        } finally {
          probe.busy += performance.now() - start;
          probe.callbacks += 1;
        }
      });
  });
}

type Frames = { fps: Record<string, number>; frameMs: Record<string, number> };

async function measureFps(
  page: Page,
  ui: import("../adapters").UiAdapter,
): Promise<Frames> {
  const fps: Record<string, number> = {};
  const frameMs: Record<string, number> = {};
  await installFrameProbe(page);
  for (const kind of AVATARS) {
    await page.evaluate((k) => localStorage.setItem("antares-avatar", k), kind);
    await ui.goto();
    await page.waitForTimeout(1_000);
    const measure = await page.evaluate(
      (seconds) =>
        new Promise<{ fps: number; frameMs: number }>((resolve) => {
          const probe = (
            window as unknown as {
              __frames: { busy: number; callbacks: number };
            }
          ).__frames;
          probe.busy = 0;
          let frames = 0;
          const start = performance.now();
          const step = (now: number) => {
            frames += 1;
            if (now - start < seconds * 1000) {
              requestAnimationFrame(step);
              return;
            }
            const elapsed = now - start;
            resolve({
              fps: (frames * 1000) / elapsed,
              frameMs: probe.busy / frames,
            });
          };
          requestAnimationFrame(step);
        }),
      FPS_SECONDS,
    );
    fps[kind] = measure.fps;
    frameMs[kind] = measure.frameMs;
  }
  return { fps, frameMs };
}

test("rendu Markdown et images par seconde @perf", async ({ page, ui }) => {
  test.setTimeout(10 * 60_000);
  await page.route("**/voices/voices.json", (route) =>
    route.fulfill({
      path: new URL("../fixtures/api/voices.json", import.meta.url).pathname,
    }),
  );
  const markdown5000 = await measureRender(page, ui);
  const { fps, frameMs } = await measureFps(page, ui);
  const rendu: Rendu = { markdown5000, fps, frameMs };

  mkdirSync("tests/results", { recursive: true });
  const file = `tests/results/rendu-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify(rendu, null, 2));
  test.info().annotations.push({ type: "résultat", description: file });
  console.log(JSON.stringify(rendu));

  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  if (process.env.UPDATE_BASELINE) {
    baseline.rendu = {
      date: new Date().toISOString().slice(0, 10),
      gpu: "swiftshader (sans GPU)",
      ...rendu,
    };
    writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
    return;
  }
  const reference = baseline.rendu as Rendu;
  expect
    .soft(markdown5000.median, "MD-4 : rendu de 5 000 caractères (ms)")
    .toBeLessThanOrEqual(
      process.env.ANTARES_UI === "next"
        ? Math.max(
            reference.markdown5000.median * RENDER_TOLERANCE,
            reference.markdown5000.median + NEXT_RENDER_EXCEPTION_MS,
          )
        : reference.markdown5000.median * RENDER_TOLERANCE,
    );
  for (const kind of AVATARS) {
    expect
      .soft(fps[kind], `AV-4 : images par seconde (${kind})`)
      .toBeGreaterThanOrEqual((reference.fps[kind] ?? 0) * (1 - FPS_DROP));
  }
});
