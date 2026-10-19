// Captures (sombre, clair) de l'écran d'appel et de la fenêtre Réglages
import { chromium } from "@playwright/test";
const [url, prefix, settingsSelector] = process.argv.slice(2);
const browser = await chromium.launch();
for (const theme of ["dark", "light"]) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(
    (t) => localStorage.setItem("antares-theme", t),
    theme,
  );
  const page = await context.newPage();
  page.on("dialog", (d) => d.dismiss());
  await page.goto(url);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${prefix}-appel-${theme}.png` });
  await page.locator(settingsSelector).first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${prefix}-reglages-${theme}.png` });
  await context.close();
}
await browser.close();
