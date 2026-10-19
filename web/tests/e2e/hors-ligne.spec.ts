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

  test("RS-3 : Internet coupé, indicateur et réponse annotée sans recherche web", async ({
    page,
    ui,
  }) => {
    const api = new MockApi(page)
      .on(/^POST \/api\/chat$/, (route) =>
        route.fulfill({
          contentType: "text/event-stream",
          body: `data: ${JSON.stringify({ choices: [{ delta: { content: "Réponse locale." } }] })}\n\ndata: [DONE]\n\n`,
        }),
      )
      .on(/^GET \/api\/turn\/last$/, (route) =>
        route.fulfill({
          json: {
            at: Date.now() / 1000 + 60,
            projects: [],
            sources: [],
            web: { offline: true },
          },
        }),
      );
    api.set("net", {
      online: false,
      search: false,
      searching: false,
      sharing: false,
    });
    await api.install();
    await ui.goto();
    await expect(ui.netIndicator()).toHaveText("Hors ligne");
    await expect(ui.netIndicator()).toHaveAttribute(
      "title",
      "Pas de connexion à Internet : pas de recherche web, modèles locaux seulement",
    );
    await ui.sendText("Quelles sont les nouveautés de nginx ?");
    await expect(ui.lastAssistantLine()).toContainText("Réponse locale.");
    await expect(ui.lastAssistantLine()).toContainText(
      "hors ligne : réponse sans recherche web",
    );
  });
});
