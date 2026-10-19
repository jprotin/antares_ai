// Hors ligne strict (projet offline-strict) : toute requête hors de l'origine est
// interrompue ; l'interface se charge et reste utilisable. RS-3 (recherche web et
// Claude coupés) rejoint ce fichier au lot 7.
import { MockApi } from "../support/mock-api";
import { expect, test } from "../support/test";

test.describe("hors ligne @offline", () => {
  test("chargement, thème et fenêtre sans aucune requête externe", async ({
    page,
    ui,
  }) => {
    await new MockApi(page).install();
    await ui.goto();
    await expect(ui.callButton()).toBeVisible();
    await ui.toggleTheme();
    await ui.openDialog("settings");
    await ui.closeDialog("settings", "escape");
    await expect.poll(() => ui.isDialogOpen("settings")).toBe(false);
  });
});
