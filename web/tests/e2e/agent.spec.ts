// Sélecteur d'agent (grille AG-1) en mock : recherche, choix, teinte du domaine.
import { MockApi } from "../support/mock-api";
import { expect, test } from "../support/test";

test.describe("agent et mode @mock @appel @lot3", () => {
  test("AG-1 : agent Sécurité choisi par recherche, teinte 246 et réglage enregistré", async ({
    page,
    ui,
  }) => {
    const api = await new MockApi(page).install();
    await ui.goto();
    await ui.pickAgent("Revue sécurité");
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--hue")
            .trim(),
        ),
      )
      .toBe("246");
    const put = api.writes().find((call) => call.path === "/api/settings");
    expect((put?.body as { agent?: string }).agent).toBeTruthy();
  });

  test("AG-2 : mode choisi au clavier, focus rendu au bouton", async ({
    page,
    ui,
  }) => {
    const api = await new MockApi(page).install();
    await ui.goto();
    const button = page.getByRole("button", { name: /Mode/ }).first();
    await button.click();
    // Option active à l'ouverture : le mode courant ; flèche bas puis Entrée
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect
      .poll(
        () =>
          (
            api.writes().find((call) => call.path === "/api/settings")?.body as
              { mode?: string } | undefined
          )?.mode,
      )
      .toBeTruthy();
    const put = api.writes().find((call) => call.path === "/api/settings");
    expect((put?.body as { mode: string }).mode).not.toBe("standard");
    await expect(button).toBeFocused();

    await button.click();
    await page.keyboard.press("Escape");
    await expect(button).toBeFocused();
  });
});
