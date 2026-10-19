// Avatars et voix (grille AV) en mock : catalogue des voix servi par la fixture, la voix
// suit l'avatar, choix Mr / Miss Antares sur l'orbe seulement, repli sans WebGL.
import { MockApi } from "../support/mock-api";
import { expect, test } from "../support/test";

const VOICES = new URL("../fixtures/api/voices.json", import.meta.url);

function voiceWrites(api: MockApi) {
  return api
    .writes()
    .filter((call) => call.method === "PUT" && call.path === "/api/settings")
    .map((call) => (call.body as { voice?: string }).voice);
}

test.describe("avatars @mock @avatars @lot4", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/voices/voices.json", (route) =>
      route.fulfill({ path: VOICES.pathname }),
    );
  });

  test("AV-1 : voix liée à l'avatar, Mr ou Miss Antares sur l'orbe seulement", async ({
    page,
    ui,
  }) => {
    const api = await new MockApi(page).install();
    await ui.goto();
    await ui.openDialog("settings");
    const dialog = ui.dialog("settings");
    const avatar = (kind: string) =>
      dialog.locator(`input[name="avatar"][value="${kind}"]`);
    const label = (kind: string) =>
      dialog.locator("label").filter({
        has: page.locator(`input[name="avatar"][value="${kind}"]`),
      });
    const orbVoices = dialog.locator("#orb-voices");

    // Avatar par défaut (cyborg 3D) aligné sur la voix enregistrée : rien envoyé
    await expect(avatar("face3d")).toBeChecked();
    expect(voiceWrites(api)).toEqual([]);
    await expect(label("face3d")).toContainText("Voix : Terminator");
    await expect(label("visor")).toContainText("Voix : Chappie");
    await expect(label("bender")).toContainText("Voix : Bender");
    await expect(label("orb")).toContainText(
      "Voix au choix : Mr Antares ou Miss Antares",
    );
    await expect(orbVoices).toBeHidden();

    await avatar("orb").check();
    await expect(orbVoices).toBeVisible();
    await expect(orbVoices.locator('input[name="voice"]')).toHaveCount(2);
    await orbVoices.locator('input[name="voice"][value="sohee"]').check();
    await dialog.getByRole("button", { name: "Appliquer" }).click();
    await expect.poll(() => ui.isDialogOpen("settings")).toBe(false);
    expect(voiceWrites(api)).toEqual(["sohee"]);
    expect(
      await page.evaluate(() => localStorage.getItem("antares-avatar")),
    ).toBe("orb");

    await ui.openDialog("settings");
    await expect(orbVoices).toBeVisible();
    await expect(
      orbVoices.locator('input[name="voice"][value="sohee"]'),
    ).toBeChecked();
    await avatar("bender").check();
    await expect(orbVoices).toBeHidden();
    await dialog.getByRole("button", { name: "Appliquer" }).click();
    await expect.poll(() => voiceWrites(api)).toEqual(["sohee", "bender"]);
  });

  test("AV-1b : avatar mémorisé, voix réalignée au chargement", async ({
    page,
    ui,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem("antares-avatar", "visor"),
    );
    const api = await new MockApi(page).install();
    await ui.goto();
    await expect.poll(() => voiceWrites(api)).toEqual(["chappie"]);
  });

  test("AV-2 : sans WebGL, repli sur l'orbe sans erreur", async ({
    page,
    ui,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("antares-avatar", "bender");
      const native = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (/webgl/i.test(type)) return null;
        return (native as (...args: unknown[]) => unknown).call(
          this,
          type,
          ...rest,
        );
      } as typeof native;
    });
    const api = await new MockApi(page).install();
    await ui.goto();
    // Voix réalignée sur l'avatar réellement affiché (l'orbe)
    await expect.poll(() => voiceWrites(api)).toEqual(["ryan"]);
    await ui.openDialog("settings");
    const dialog = ui.dialog("settings");
    await expect(
      dialog.locator('input[name="avatar"][value="orb"]'),
    ).toBeChecked();
    await expect(dialog.locator("#orb-voices")).toBeVisible();

    // Un avatar 3D choisi retombe sur l'orbe
    await dialog.locator('input[name="avatar"][value="visor"]').check();
    await dialog.getByRole("button", { name: "Appliquer" }).click();
    await expect.poll(() => ui.isDialogOpen("settings")).toBe(false);
    expect(
      await page.evaluate(() => localStorage.getItem("antares-avatar")),
    ).toBe("orb");
  });

  test("AV-3 : dix changements d'avatar, au plus un contexte WebGL vivant (amélioration)", async ({
    page,
    ui,
  }) => {
    // Chaque contexte WebGL créé est suivi ; isContextLost() dit s'il a été rendu
    await page.addInitScript(() => {
      const contexts: WebGLRenderingContext[] = [];
      (window as unknown as { __gl: typeof contexts }).__gl = contexts;
      const native = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        const context = (native as (...args: unknown[]) => unknown).call(
          this,
          type,
          ...rest,
        );
        if (/webgl/i.test(type) && context)
          contexts.push(context as WebGLRenderingContext);
        return context;
      } as typeof native;
    });
    await new MockApi(page).install();
    await ui.goto();
    const kinds = ["visor", "bender", "face3d", "orb", "visor"];
    for (let i = 0; i < 10; i += 1) {
      await ui.openDialog("settings");
      const dialog = ui.dialog("settings");
      await dialog
        .locator(`input[name="avatar"][value="${kinds[i % kinds.length]}"]`)
        .check();
      await dialog.getByRole("button", { name: "Appliquer" }).click();
      await expect.poll(() => ui.isDialogOpen("settings")).toBe(false);
    }
    // Les rendus 3D ont bien été créés (sinon le test ne prouverait rien)
    expect(
      await page.evaluate(
        () => (window as unknown as { __gl: unknown[] }).__gl.length,
      ),
    ).toBeGreaterThan(2);
    const alive = await page.evaluate(
      () =>
        (window as unknown as { __gl: WebGLRenderingContext[] }).__gl.filter(
          (gl) => !gl.isContextLost(),
        ).length,
    );
    test.info().annotations.push({
      type: "contextes WebGL vivants",
      description: String(alive),
    });
    if (process.env.ANTARES_UI === "next") expect(alive).toBeLessThanOrEqual(1);
    else
      expect(alive, "KO attendu sur l'ancienne interface").toBeGreaterThan(1);
  });
});
