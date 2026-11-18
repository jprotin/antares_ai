// Menu de gauche de la nouvelle interface (shadcn Sidebar) : ouvre une page par son
// entrée, et sa sous-entrée (accordéon) le cas échéant. Sur mobile, le menu est un
// tiroir : il s'ouvre d'abord par le bouton de la barre du haut.
import type { Page } from "@playwright/test";

export const MENU_TOGGLE = "Afficher ou masquer le menu";

export async function openPage(page: Page, entry: string, sub?: string) {
  const menu = page.locator('[data-slot="sidebar"]');
  const target = menu.getByRole("link", { name: sub ?? entry, exact: true });
  if (
    !(await menu
      .getByRole("link", { name: "Accueil", exact: true })
      .isVisible())
  )
    await page.getByRole("button", { name: MENU_TOGGLE }).first().click();
  if (sub && !(await target.isVisible()))
    await menu.getByRole("button", { name: entry, exact: true }).click();
  await target.click();
}
