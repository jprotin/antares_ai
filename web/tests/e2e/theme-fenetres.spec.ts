// Thème, préférences et fenêtres (grille TH, PR, FE-6, AG) en mock.
import { MockApi } from "../support/mock-api";
import { expect, isLegacy, test } from "../support/test";

test.describe("thème et préférences @mock @theme @lot2", () => {
  test.beforeEach(async ({ page }) => {
    await new MockApi(page).install();
  });

  test("TH-1 : bascule auto, sombre, clair et persistance", async ({
    page,
    ui,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await ui.goto();
    const theme = () =>
      page.evaluate(() => document.documentElement.dataset.theme);
    const stored = () =>
      page.evaluate(() => localStorage.getItem("antares-theme"));
    expect(await theme()).toBe("dark");
    await ui.toggleTheme();
    expect(await stored()).toBe("dark");
    await ui.toggleTheme();
    expect(await stored()).toBe("light");
    expect(await theme()).toBe("light");
    await page.reload();
    expect(await theme()).toBe("light");
    await ui.toggleTheme();
    expect(await stored()).toBe("auto");
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(theme).toBe("light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(theme).toBe("dark");
  });

  test("PR-1 : préférences héritées reprises", async ({ page, ui }) => {
    await page.addInitScript(() => {
      localStorage.setItem("antares-theme", "light");
      localStorage.setItem("antares.noiseFilter", "strong");
    });
    await ui.goto();
    expect(
      await page.evaluate(() => document.documentElement.dataset.theme),
    ).toBe("light");
    expect(
      await page.evaluate(() => localStorage.getItem("antares.noiseFilter")),
    ).toBe("strong");
  });

  test("TH-2 : pas de flash du thème clair au premier rendu (amélioration)", async ({
    page,
    baseURL,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("antares-theme", "light");
      // Thème lu dès que <html> existe, avant tout module différé
      document.addEventListener(
        "readystatechange",
        () => {
          (window as unknown as { __early?: string }).__early ??=
            document.documentElement.dataset.theme ?? "aucun";
        },
        { once: true },
      );
    });
    await page.goto(baseURL ?? "./");
    const early = await page.evaluate(
      () => (window as unknown as { __early?: string }).__early,
    );
    test.info().annotations.push({
      type: "thème au premier rendu",
      description: String(early),
    });
    if (isLegacy())
      expect(early, "KO attendu sur l'ancienne interface").not.toBe("light");
    else expect(early).toBe("light");
  });
});

test.describe("fenêtres @mock @fenetres @lot5", () => {
  test.beforeEach(async ({ page }) => {
    await new MockApi(page).install();
  });

  test("FE-6 : Échap, clic extérieur et focus rendu", async ({ page, ui }) => {
    await ui.goto();
    await ui.openDialog("settings");
    await ui.closeDialog("settings", "escape");
    await expect.poll(() => ui.isDialogOpen("settings")).toBe(false);

    await ui.openDialog("settings");
    await page.waitForTimeout(300); // les fenêtres écoutent les clics extérieurs après l'ouverture
    await ui.closeDialog("settings", "outside");
    await expect.poll(() => ui.isDialogOpen("settings")).toBe(false);

    await ui.openDialog("settings");
    for (let i = 0; i < 40; i += 1) await page.keyboard.press("Tab");
    const inside = await ui
      .dialog("settings")
      .evaluate((dialog) => dialog.contains(document.activeElement));
    expect(inside, "focus piégé dans la fenêtre").toBe(true);
  });
});
