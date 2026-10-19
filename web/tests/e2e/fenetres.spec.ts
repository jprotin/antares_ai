// Fenêtres CRUD (grille FE) en mock : méthode et corps des requêtes vérifiés, confirm
// accepté et refusé. Aucune donnée réelle touchée.
import { readFileSync } from "node:fs";

import { MockApi } from "../support/mock-api";
import { expect, isLegacy, test } from "../support/test";

const SETTINGS = JSON.parse(
  readFileSync(
    new URL("../fixtures/api/settings.json", import.meta.url),
    "utf8",
  ),
);

test.describe("fenêtres @mock @fenetres @lot5", () => {
  test("FE-1 : Réglages, Appliquer envoie le modèle choisi", async ({
    page,
    ui,
  }) => {
    const api = await new MockApi(page).install();
    await ui.goto();
    await ui.openDialog("settings");
    const dialog = ui.dialog("settings");
    const models = dialog.locator('input[name="model"]');
    await expect(models.first()).toBeVisible();
    const target = models.nth(1);
    const value = await target.getAttribute("value");
    await target.check();
    await dialog.getByRole("button", { name: "Appliquer" }).click();
    await expect.poll(() => ui.isDialogOpen("settings")).toBe(false);
    const put = api.writes().find((call) => call.path === "/api/settings");
    expect(put?.method).toBe("PUT");
    expect((put?.body as { model?: string }).model).toBe(value);
  });

  test("FE-1b : Réglages, Annuler n'envoie rien", async ({ page, ui }) => {
    const api = await new MockApi(page).install();
    await ui.goto();
    await ui.openDialog("settings");
    await ui.dialog("settings").locator('input[name="model"]').nth(1).check();
    await ui
      .dialog("settings")
      .getByRole("button", { name: "Annuler" })
      .click();
    await expect.poll(() => ui.isDialogOpen("settings")).toBe(false);
    expect(
      api.writes().filter((call) => call.path === "/api/settings"),
    ).toEqual([]);
  });

  test.describe("erreur serveur", () => {
    // Réponse 422 : le navigateur journalise l'échec de la ressource
    test.use({ allowConsoleErrors: ["Failed to load resource"] });
    test("FE-1c : Réglages, erreur serveur affichée", async ({ page, ui }) => {
      await new MockApi(page)
        .on(/^PUT \/api\/settings$/, (route) =>
          route.fulfill({ status: 422, json: { detail: "modèle inconnu" } }),
        )
        .install();
      test
        .info()
        .annotations.push({ type: "console", description: "422 attendu" });
      await ui.goto();
      await ui.openDialog("settings");
      await ui
        .dialog("settings")
        .getByRole("button", { name: "Appliquer" })
        .click();
      await expect(ui.dialog("settings")).toContainText("modèle inconnu");
    });
  });

  test("FE-3 : Agents, création, filtre et suppression avec confirm", async ({
    page,
    ui,
  }) => {
    const api = await new MockApi(page).install();
    await ui.goto();
    await ui.openDialog("agents");
    const dialog = ui.dialog("agents");
    await expect(dialog.locator(".agent-card").first()).toBeVisible();

    await dialog.getByRole("button", { name: "Nouvel agent" }).click();
    await page.locator("#agent-name").fill("Agent de test");
    await page.locator("#agent-domain").fill("Perso");
    await page.locator("#agent-usage").fill("Revue");
    await page.locator("#agent-instructions").fill("Tu relis avec soin.");
    await dialog.getByRole("button", { name: /Enregistrer|Créer/ }).click();
    const post = api
      .writes()
      .find((call) => call.method === "POST" && call.path === "/api/agents");
    expect(post?.body).toMatchObject({
      name: "Agent de test",
      domain: "Perso",
      usage: "Revue",
    });

    const before = api.writes().length;
    page.once("dialog", (d) => d.dismiss());
    await dialog.getByRole("button", { name: "Supprimer" }).first().click();
    expect(api.writes().length).toBe(before);

    page.once("dialog", (d) => d.accept());
    await dialog.getByRole("button", { name: "Supprimer" }).first().click();
    await expect
      .poll(() => api.writes().some((call) => call.method === "DELETE"))
      .toBe(true);
  });

  test("FE-1d : Réglages ouverts avant le profil, rien n'est effacé", async ({
    page,
    ui,
  }) => {
    // Amélioration (grille FE-9) : l'ancienne interface plante dans ce cas
    test.fail(isLegacy(), "KO attendu sur l'ancienne interface");
    let release: () => void = () => {};
    const ready = new Promise<void>((resolve) => (release = resolve));
    const api = await new MockApi(page)
      .on(/^GET \/api\/settings$/, async (route) => {
        await ready;
        return route.fulfill({ json: SETTINGS });
      })
      .install();
    await ui.goto();
    await ui.openDialog("settings");
    release();
    const dialog = ui.dialog("settings");
    await expect(dialog.locator('input[name="model"]:checked')).toHaveCount(1);
    await dialog.getByRole("button", { name: "Appliquer" }).click();
    await expect.poll(() => ui.isDialogOpen("settings")).toBe(false);
    const put = api.writes().find((call) => call.path === "/api/settings");
    expect(put?.body).toMatchObject({
      model: "claude:sonnet",
      voice: "terminator",
      project: "",
    });
  });

  test("FE-6b : fenêtre ouverte depuis Réglages, Échap rend le focus à son bouton", async ({
    page,
    ui,
  }) => {
    await new MockApi(page).install();
    await ui.goto();
    await ui.openDialog("agents");
    await page.keyboard.press("Escape");
    await expect.poll(() => ui.isDialogOpen("agents")).toBe(false);
    expect(await ui.isDialogOpen("settings")).toBe(true);
    await expect(page.locator("#open-agents")).toBeFocused();
  });
});
