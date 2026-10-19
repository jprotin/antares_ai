// Ancienne interface (frontend/) : <dialog> natifs, sélecteurs maison, états sur .app.
import type { Locator, Page } from "@playwright/test";

import type { CloseHow, DialogName, UiAdapter } from "./index";

const OPENERS = {
  settings: "#open-settings",
  connections: "#open-connections",
  agents: "#open-agents",
  knowledge: "#open-knowledge",
  "rag-projects": "#open-rag-projects",
  rehearsal: "#open-rehearsal",
} satisfies Record<DialogName, string>;

const DIALOGS = {
  settings: "#settings",
  connections: "#connections",
  agents: "#agents",
  knowledge: "#knowledge-panel",
  "rag-projects": "#rag-projects",
  rehearsal: "#rehearsal-setup",
} satisfies Record<DialogName, string>;

// Ouvreurs placés dans la fenêtre Réglages (pas sur l'écran d'appel)
const INSIDE_SETTINGS: DialogName[] = ["connections", "agents", "rag-projects"];

export class LegacyAdapter implements UiAdapter {
  constructor(readonly page: Page) {}

  async goto() {
    await this.page.goto("./");
    await this.page.locator(".app").waitFor();
  }

  dialog(name: DialogName): Locator {
    return this.page.locator(DIALOGS[name]);
  }

  async openDialog(name: DialogName) {
    if (
      INSIDE_SETTINGS.includes(name) &&
      !(await this.isDialogOpen("settings"))
    ) {
      await this.openDialog("settings");
    }
    await this.page.locator(OPENERS[name]).click();
    await this.dialog(name).and(this.page.locator("[open]")).waitFor();
  }

  async closeDialog(name: DialogName, how: CloseHow) {
    const dialog = this.dialog(name);
    if (how === "escape") {
      await this.page.keyboard.press("Escape");
    } else if (how === "outside") {
      // Clic sur le fond du <dialog> (closeOnBackdrop) : coin haut gauche de l'écran
      const box = await dialog.boundingBox();
      await this.page.mouse.click(box ? Math.max(1, box.x - 10) : 5, 5);
    } else {
      await dialog
        .getByRole("button", { name: /Fermer|Annuler/ })
        .first()
        .click();
    }
  }

  async isDialogOpen(name: DialogName) {
    return this.dialog(name).evaluate((element) =>
      element.hasAttribute("open"),
    );
  }

  private async pick(root: string, name: string) {
    await this.page.locator(`${root} > button`).first().click();
    const search = this.page
      .locator(`${root} input[type="search"], ${root} input`)
      .first();
    if (await search.isVisible()) await search.fill(name);
    await this.page
      .locator(`${root} [role="option"]`, { hasText: name })
      .first()
      .click();
  }

  async pickAgent(name: string) {
    await this.pick("#agent-picker", name);
  }

  async pickMode(name: string) {
    await this.pick("#mode-picker", name);
  }

  async toggleTheme() {
    await this.page.locator("#theme-toggle").click();
  }

  callButton(): Locator {
    return this.page.locator("#call");
  }

  async startCall() {
    await this.callButton().click();
  }

  async hangUp() {
    await this.callButton().click();
  }

  async callState() {
    return (
      (await this.page.locator(".app").getAttribute("data-state")) ?? undefined
    );
  }

  status(): Locator {
    return this.page.locator("#status");
  }

  composer(): Locator {
    return this.page.locator("#composer-text");
  }

  async sendText(text: string) {
    await this.composer().fill(text);
    await this.page.locator("#composer-send").click();
  }

  async addToContext(text: string) {
    await this.composer().fill(text);
    await this.page.locator("#composer-context").click();
  }

  subtitles(): Locator {
    return this.page.locator("#subtitles");
  }

  lastAssistantLine(): Locator {
    return this.page.locator("#subtitles .line--assistant").last();
  }
}
