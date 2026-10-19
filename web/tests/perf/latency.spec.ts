// Latence ABAB (stratégie de tests, 7) : appels alternés entre deux interfaces servies en
// même temps, une session à la fois. A = LATENCY_A, B = LATENCY_B (défaut des deux :
// 8765, série A/A ; pour comparer deux interfaces, servir la seconde sur un autre port).
// Résultat : tests/results/latency-<date>.json (comparé par scripts/compare-latency.mjs).
import { mkdirSync, writeFileSync } from "node:fs";

import { installProbes, latencies, type Latency } from "../support/probes";
import { expect, guardWrites, test } from "../support/test";

const A = process.env.LATENCY_A ?? "http://127.0.0.1:8765/";
const B = process.env.LATENCY_B ?? A;
const N = Number(process.env.LATENCY_N ?? 20);
const MAX_FAILURES = 2;

test("latence ABAB @perf", async ({ browser }) => {
  test.setTimeout(60 * 60_000);
  const series: Record<"A" | "B", Latency[]> = { A: [], B: [] };
  const refused: string[] = [];
  const failures: Record<"A" | "B", number> = { A: 0, B: 0 };

  async function call(url: string): Promise<Latency | undefined> {
    const context = await browser.newContext({ permissions: ["microphone"] });
    // Contextes créés ici : la garde d'écriture leur est appliquée explicitement
    await guardWrites(context, refused);
    const page = await context.newPage();
    await installProbes(page);
    await page.goto(url);
    const button = page.locator("#call, [data-testid=call]").first();
    await button.click();
    try {
      await page.waitForFunction(
        () =>
          (window as unknown as { __probe: { latencies: unknown[] } }).__probe
            .latencies.length > 0,
        null,
        { timeout: 45_000 },
      );
      return (await latencies(page))[0];
    } catch {
      return undefined;
    } finally {
      await button.click().catch(() => {});
      await context.close();
    }
  }

  // Appel à froid exclu pour chaque interface
  await call(A);
  await call(B);
  for (let i = 0; i < N; i += 1) {
    for (const [name, url] of [
      ["A", A],
      ["B", B],
    ] as const) {
      let measure = await call(url);
      if (!measure) measure = await call(url);
      if (measure) series[name].push(measure);
      else failures[name] += 1;
    }
  }

  mkdirSync("tests/results", { recursive: true });
  const file = `tests/results/latency-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify({ A, B, N, failures, series }, null, 2));
  test.info().annotations.push({ type: "résultat", description: file });
  expect(refused, "écritures refusées par la garde").toEqual([]);
  if (failures.A > MAX_FAILURES || failures.B > MAX_FAILURES) {
    throw new Error(`Série invalide : ${JSON.stringify(failures)} échecs`);
  }
});
