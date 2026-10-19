// Projet smoke : interface servie, chargement propre, CSP attendue, une fenêtre.
import { expect, isLegacy, test } from "../support/test";

// Base de la CSP, inchangée depuis l'ancienne interface (décision du spike)
const BASE_CSP =
  "default-src 'self'; connect-src 'self'; media-src 'self' blob:; style-src 'self'; script-src 'self'";
// Ajouts de l'audit de sécurité (lot 7) : jamais intégrée dans une page tierce
const HARDENED_CSP = `${BASE_CSP}; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'`;

test("smoke : la page se charge sans violation CSP ni erreur JS @smoke", async ({
  ui,
  guards,
}) => {
  await ui.goto();
  await expect(ui.callButton()).toBeVisible();
  expect(await guards.csp()).toEqual([]);
});

test("smoke : interface servie identifiée @smoke", async ({ page }) => {
  const html = await (await page.request.get("./")).text();
  if (isLegacy()) expect(html).toContain('src="app.js"');
  else expect(html).toContain("theme-init.js");
});

test("smoke : en-tête Content-Security-Policy inchangé @smoke", async ({
  page,
}) => {
  const response = await page.request.get("./");
  const csp = response.headers()["content-security-policy"];
  // L'ancienne interface en service garde la CSP de base jusqu'à son redémarrage
  if (isLegacy() && csp === BASE_CSP) return;
  expect(csp).toBe(HARDENED_CSP);
  expect(response.headers()["x-frame-options"]).toBe("DENY");
});

test("smoke : ouverture et fermeture d'une fenêtre @smoke", async ({ ui }) => {
  await ui.goto();
  await ui.openDialog("settings");
  expect(await ui.isDialogOpen("settings")).toBe(true);
  await ui.closeDialog("settings", "escape");
  await expect.poll(() => ui.isDialogOpen("settings")).toBe(false);
});
