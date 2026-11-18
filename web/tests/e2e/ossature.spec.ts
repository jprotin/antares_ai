// Ossature à menu et pages (ADR 0015, nouvelle interface seulement) en mock : accueil par
// défaut, menu accordéon, adresses en « # », retour arrière, appel qui continue d'une
// page à l'autre, tableau de bord, tiroir sur mobile.
import type { Page } from "@playwright/test";

import { MENU_TOGGLE, openPage } from "../support/menu";
import { MockApi } from "../support/mock-api";
import { expect, isLegacy, test } from "../support/test";
import { RealtimeMock } from "../support/ws-scenario";

const menu = (page: Page) => page.locator('[data-slot="sidebar"]').first();
const link = (page: Page, name: string) =>
  menu(page).getByRole("link", { name, exact: true });
const trail = (page: Page) =>
  page.getByRole("navigation", { name: /breadcrumb/i });

test.describe("ossature @mock @ossature", () => {
  test.skip(isLegacy(), "menu et pages absents de l'ancienne interface");
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await new MockApi(page).install();
  });

  test("OS-01 : accueil par défaut, menu et tableau de bord", async ({
    page,
  }) => {
    await page.goto("./");
    await expect(page.getByTestId("app")).toHaveAttribute(
      "data-page",
      "accueil",
    );
    for (const name of ["Accueil", "Conversation", "Répétition", "Actualités"])
      await expect(link(page, name)).toBeVisible();
    await expect(link(page, "Accueil")).toHaveAttribute("aria-current", "page");
    await expect(
      menu(page).getByRole("button", { name: "Réglages", exact: true }),
    ).toBeVisible();
    for (const id of [
      "home-weather",
      "home-assistant",
      "home-top-day",
      "home-top-week",
      "home-ideas",
      "home-rehearsal",
    ])
      await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId("home-weather")).toContainText("°C");
    // Avatar dans la carte de l'assistant, entier (le canvas remplit son cadre)
    const frame = page.getByTestId("home-avatar");
    await expect(frame.locator("canvas")).toHaveCount(1);
    const [box, canvas] = await Promise.all([
      frame.boundingBox(),
      frame.locator("canvas").boundingBox(),
    ]);
    expect(
      Math.abs((canvas?.height ?? 0) - (box?.height ?? 0)),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs((canvas?.width ?? 0) - (box?.width ?? 0)),
    ).toBeLessThanOrEqual(1);
    // Un seul avatar affiché : il revient sur la scène en allant à la Conversation
    await expect(page.locator("canvas.orb")).toHaveCount(1);
    await expect(
      page.getByTestId("home-top-day").getByRole("listitem"),
    ).not.toHaveCount(0);
  });

  test("OS-02 : adresses, fil d'Ariane et retour arrière", async ({ page }) => {
    await page.goto("./#/actualites");
    await expect(
      page.getByRole("region", { name: "Veille IA et météo", exact: true }),
    ).toBeVisible();
    await openPage(page, "Réglages", "Agents");
    await expect(page).toHaveURL(/#\/reglages\/agents$/);
    await expect(trail(page)).toContainText("Réglages");
    await expect(trail(page)).toContainText("Agents");
    await page.goBack();
    await expect(page).toHaveURL(/#\/actualites$/);
    await expect(link(page, "Actualités")).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Adresse inconnue : accueil
    await page.goto("./#/inconnue");
    await expect(page.getByTestId("home-weather")).toBeVisible();
  });

  test("OS-03 : Réglages en accordéon, sous-page Général par défaut", async ({
    page,
  }) => {
    await page.goto("./#/reglages");
    await expect(
      page.getByRole("region", { name: "Réglages", exact: true }),
    ).toBeVisible();
    const general = link(page, "Général");
    await expect(general).toHaveAttribute("aria-current", "page");
    // Refermé à la main, puis rouvert
    await menu(page)
      .getByRole("button", { name: "Réglages", exact: true })
      .click();
    await expect(general).toBeHidden();
    await menu(page)
      .getByRole("button", { name: "Réglages", exact: true })
      .click();
    await link(page, "Connexions").click();
    await expect(
      page.getByRole("region", { name: "Connexions", exact: true }),
    ).toBeVisible();
    // Bouton des Réglages vers une sous-page
    await openPage(page, "Réglages", "Général");
    await page.getByRole("button", { name: "Gérer les agents" }).click();
    await expect(page).toHaveURL(/#\/reglages\/agents$/);
  });

  test("OS-04 : l'appel continue d'une page à l'autre, raccrocher depuis le menu", async ({
    page,
    ui,
  }) => {
    const realtime = await new RealtimeMock(page).install();
    await ui.goto();
    await ui.startCall();
    await realtime.connectedSocket();
    await expect.poll(() => ui.callState()).toBe("listening");
    await openPage(page, "Actualités");
    await expect.poll(() => ui.callState()).toBe("listening");
    const card = page.getByTestId("sidebar-call");
    await expect(card).toContainText("Je vous écoute");
    // La réponse se joue toujours (sortie audio dans l'ossature)
    await expect(page.getByTestId("speaker")).toHaveCount(1);
    await card.getByRole("button", { name: "Raccrocher" }).click();
    await expect.poll(() => ui.callState()).toBe("idle");
    await expect(card).toHaveCount(0);
  });

  test("OS-05 : Appeler depuis l'accueil", async ({ page, ui }) => {
    const realtime = await new RealtimeMock(page).install();
    await page.goto("./");
    await page
      .getByTestId("home-assistant")
      .getByRole("button", { name: "Appeler" })
      .click();
    await realtime.connectedSocket();
    await expect.poll(() => ui.callState()).toBe("listening");
    await expect(
      page.getByTestId("home-assistant").getByRole("button", {
        name: "Raccrocher",
      }),
    ).toBeVisible();
  });

  test("OS-06 : mobile, menu en tiroir refermé après le choix", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("./");
    await expect(link(page, "Conversation")).toBeHidden();
    await page.getByRole("button", { name: MENU_TOGGLE }).first().click();
    await link(page, "Conversation").click();
    await expect(page).toHaveURL(/#\/conversation$/);
    await expect(link(page, "Conversation")).toBeHidden();
    await expect(page.getByTestId("call")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
  });
});
