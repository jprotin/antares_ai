// Relevé des appels /api faits par l'ancienne interface au chargement et à l'ouverture des fenêtres
import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage();
const calls = new Map();
page.on("request", (r) => {
  const u = new URL(r.url());
  if (
    u.pathname.startsWith("/api/") ||
    u.pathname === "/config.json" ||
    u.pathname.startsWith("/voices/")
  )
    calls.set(
      `${r.method()} ${u.pathname}${u.search}`,
      (calls.get(`${r.method()} ${u.pathname}${u.search}`) ?? 0) + 1,
    );
});
page.on("dialog", (d) => d.dismiss());
await page.goto("http://127.0.0.1:8765/");
await page.waitForTimeout(2500);
for (const id of [
  "open-settings",
  "open-connections",
  "open-agents",
  "open-knowledge",
  "open-rag-projects",
  "open-rehearsal",
]) {
  const b = page.locator(`#${id}`);
  if (await b.count()) {
    await b.click({ trial: false }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
}
console.log([...calls.entries()].map(([k, v]) => `${v}× ${k}`).join("\n"));
await browser.close();
