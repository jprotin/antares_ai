// Journal de la veille en mock (J-01 à J-05) : mini-fenêtre de l'avatar en haut à gauche
// de la Veille, lancement de l'appel avec le message caché, sujet « À l'antenne »,
// « Sujet suivant », « Arrêter », retour de l'avatar sur la scène, erreurs.
import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";

import { MockApi } from "../support/mock-api";
import { expect, isLegacy, test } from "../support/test";
import { RealtimeMock, type ServerEvent } from "../support/ws-scenario";

const LATEST = JSON.parse(
  readFileSync(
    new URL("../fixtures/api/veille_latest.json", import.meta.url),
    "utf8",
  ),
);
const ITEMS = LATEST.run.items as { id: string; title: string }[];
const MARKER = "[Journal de la veille]";

type Journal = Record<string, unknown> & { active: boolean };

const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "Veille IA et météo" });
const panel = (page: Page) => page.getByTestId("veille-journal");

async function openVeille(page: Page) {
  await page.getByRole("button", { name: /^Veille IA et météo/ }).click();
  await expect(dialog(page)).toBeVisible();
}

function cues(realtime: RealtimeMock): string[] {
  return realtime.received
    .filter((e) => e.type === "conversation.item.create")
    .map((e) => {
      const item = e.item as { content: { text: string }[] };
      return item.content[0]?.text ?? "";
    });
}

const count = (realtime: RealtimeMock, type: string) =>
  realtime.received.filter((e: ServerEvent) => e.type === type).length;

// Journal simulé côté routeur : l'état renvoyé par GET suit les PUT et DELETE
function mockJournal(api: MockApi) {
  const journal: { state: Journal } = { state: { active: false } };
  api.on(/^GET \/api\/veille\/journal$/, (route) =>
    route.fulfill({ json: journal.state }),
  );
  api.on(/^PUT \/api\/veille\/journal$/, (route) => {
    journal.state = {
      active: true,
      stage: "ready",
      index: 0,
      total: 5,
      current_id: null,
      topics: ITEMS.slice(0, 5).map(({ id, title }) => ({ id, title })),
    };
    return route.fulfill({ json: journal.state });
  });
  api.on(/^DELETE \/api\/veille\/journal$/, (route) => {
    journal.state = { active: false };
    return route.fulfill({ status: 204, body: "" });
  });
  return journal;
}

test.describe("journal de la veille @mock @veille", () => {
  test.skip(isLegacy(), "veille absente de l'ancienne interface");
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("J-01 : lancement, sujet à l'antenne, sujet suivant, arrêt", async ({
    page,
    ui,
  }) => {
    const api = await new MockApi(page).install();
    const journal = mockJournal(api);
    const realtime = await new RealtimeMock(page).install();
    await ui.goto();
    await openVeille(page);

    await expect(panel(page)).toBeVisible();
    await expect(panel(page).locator("canvas")).toHaveCount(1);
    await panel(page)
      .getByRole("button", { name: "Lancer le journal" })
      .click();
    await realtime.connectedSocket();
    await expect
      .poll(() => cues(realtime))
      .toEqual([`${MARKER} Lance le journal.`]);
    await expect.poll(() => count(realtime, "response.create")).toBe(1);
    expect(api.writes().map((c) => `${c.method} ${c.path}`)).toContain(
      "PUT /api/veille/journal",
    );

    // Le routeur avance : premier sujet présenté
    journal.state = {
      ...journal.state,
      stage: "topic",
      current_id: ITEMS[0]?.id,
    };
    const onAir = page.locator('.veille-card[data-on-air="true"]');
    await expect(onAir).toHaveCount(1);
    await expect(onAir).toContainText(ITEMS[0]?.title ?? "");
    await expect(onAir).toContainText("À l'antenne");
    await expect(page.getByTestId("veille-journal-status")).toHaveText(
      "Sujet 1 sur 5",
    );
    await expect(panel(page)).toContainText("En direct");

    await panel(page).getByRole("button", { name: "Sujet suivant" }).click();
    await expect
      .poll(() => cues(realtime).at(-1))
      .toBe(`${MARKER} Sujet suivant.`);
    expect(count(realtime, "response.cancel")).toBeGreaterThanOrEqual(1);

    await panel(page).getByRole("button", { name: "Arrêter" }).click();
    await expect(
      panel(page).getByRole("button", { name: "Lancer le journal" }),
    ).toBeVisible();
    await expect(onAir).toHaveCount(0);
    expect(api.writes().map((c) => `${c.method} ${c.path}`)).toContain(
      "DELETE /api/veille/journal",
    );
    // L'appel continue : conversation libre sur la veille
    expect(await ui.callState()).not.toBe("idle");
  });

  test("J-02 : en appel, le journal part sans nouvel appel", async ({
    page,
    ui,
  }) => {
    const api = await new MockApi(page).install();
    mockJournal(api);
    const realtime = await new RealtimeMock(page).install();
    await ui.goto();
    await ui.startCall();
    await realtime.connectedSocket();
    await openVeille(page);
    await panel(page)
      .getByRole("button", { name: "Lancer le journal" })
      .click();
    await expect
      .poll(() => cues(realtime))
      .toEqual([`${MARKER} Lance le journal.`]);
    expect(count(realtime, "session.update")).toBe(1);
  });

  test("J-03 : l'avatar revient sur la scène à la fermeture", async ({
    page,
    ui,
  }) => {
    await new MockApi(page).install();
    await ui.goto();
    const outside = page.locator("canvas.orb:not(#veille canvas)");
    await expect(page.locator("canvas.orb")).toHaveCount(1);
    await openVeille(page);
    await expect(panel(page).locator("canvas.orb")).toHaveCount(1);
    await expect(page.locator("canvas.orb")).toHaveCount(1);
    // Avatar entier dans la mini-fenêtre : le canvas a la taille de l'écran
    const sizes = await panel(page).evaluate((root) => {
      const box = (selector: string) =>
        root.querySelector(selector)?.getBoundingClientRect();
      const screen = box(".veille-journal__screen");
      const canvas = box("canvas.orb");
      return [screen?.width, screen?.height, canvas?.width, canvas?.height];
    });
    expect(sizes[2]).toBeCloseTo(sizes[0] ?? 0, 0);
    expect(sizes[3]).toBeCloseTo(sizes[1] ?? 0, 0);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await expect(page.locator("canvas.orb")).toHaveCount(1);
    await expect(outside).toHaveCount(1);
  });

  test("J-04 : pas de veille, bouton désactivé", async ({ page, ui }) => {
    const api = await new MockApi(page).install();
    mockJournal(api);
    api.set("veille/latest", { ...LATEST, run: null, days: [] });
    await ui.goto();
    await openVeille(page);
    await expect(
      panel(page).getByRole("button", { name: "Lancer le journal" }),
    ).toBeDisabled();
    await expect(page.getByTestId("veille-journal-status")).toHaveText(
      "Pas encore de veille à raconter",
    );
  });

  test.describe("refus", () => {
    test.use({ allowConsoleErrors: ["Failed to load resource"] });

    test("J-05 : refus du routeur, message et pas d'appel", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page).install();
      api.on(/^PUT \/api\/veille\/journal$/, (route) =>
        route.fulfill({
          status: 409,
          json: { detail: "aucune veille à présenter pour l'instant" },
        }),
      );
      await ui.goto();
      await openVeille(page);
      await panel(page)
        .getByRole("button", { name: "Lancer le journal" })
        .click();
      await expect(panel(page).getByRole("alert")).toHaveText(
        "aucune veille à présenter pour l'instant",
      );
      expect(await ui.callState()).toBe("idle");
    });
  });
});
