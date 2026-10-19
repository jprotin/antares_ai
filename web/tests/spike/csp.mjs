// Relevé CSP (L3) : scénario complet de la page témoin sous le vrai nginx (bypassCSP
// désactivé), violations collectées par securitypolicyviolation et la console.
import { writeFileSync } from "node:fs";
import { chromium, firefox } from "@playwright/test";

const url = process.argv[2] ?? "http://127.0.0.1:8766/";
const out = process.argv[3];
const results = {};

for (const [name, engine] of [
  ["chromium", chromium],
  ["firefox", firefox],
]) {
  const browser = await engine.launch();
  const context = await browser.newContext({
    bypassCSP: false,
    colorScheme: "dark",
  });
  await context.addInitScript(() => {
    localStorage.setItem("antares-theme", "light");
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__csp.push({
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
        source: e.sourceFile,
        line: e.lineNumber,
        sample: e.sample,
      }),
    );
  });
  const page = await context.newPage();
  const consoleCsp = [];
  const errors = [];
  page.on(
    "console",
    (m) =>
      /Content.Security.Policy|CSP/i.test(m.text()) &&
      consoleCsp.push(m.text()),
  );
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => d.accept());
  await page.goto(url);
  const themeAtLoad = await page.evaluate(
    () => document.documentElement.dataset.theme,
  );

  // Fenêtre : Échap puis clic extérieur, focus rendu au déclencheur
  const trigger = page.getByTestId("open-dialog");
  await trigger.click();
  await page.getByRole("dialog").waitFor();
  const scrollLocked = await page.evaluate(
    () => getComputedStyle(document.body).overflow,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  const focusBack = await trigger.evaluate(
    (el) => el === document.activeElement,
  );
  await trigger.click();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(300); // Radix écoute les clics extérieurs après l'ouverture
  await page.mouse.click(5, 5);
  await page.getByRole("dialog").waitFor({ state: "detached" });

  await page.getByTestId("native-select").selectOption("claude");
  await page.getByTestId("agent").click();
  await page.getByPlaceholder("Chercher un agent…").fill("audit");
  await page.keyboard.press("Enter");
  const hue = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--hue").trim(),
  );
  await page.getByTestId("confirm").click();
  for (let i = 0; i < 3; i += 1) await page.getByTestId("theme").click();
  await page.getByTestId("ws").click();
  await page
    .getByTestId("ws-result")
    .filter({ hasText: /reçu|erreur|délai/ })
    .waitFor({ timeout: 15000 });
  const ws = await page.getByTestId("ws-result").textContent();
  const markdownStyle = await page
    .getByTestId("markdown")
    .evaluate((el) => el.innerHTML.includes("style="));
  const canvas = await page.locator('[data-testid="three"] canvas').count();
  await page.waitForTimeout(500);

  results[name] = {
    themeAtLoad,
    scrollLocked,
    focusBack,
    hue,
    ws,
    markdownStyle,
    canvas,
    violations: await page.evaluate(() => window.__csp),
    consoleCsp,
    errors,
  };
  await browser.close();
}
console.log(JSON.stringify(results, null, 2));
if (out) writeFileSync(out, JSON.stringify(results, null, 2));
