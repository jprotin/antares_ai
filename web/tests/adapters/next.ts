// Nouvelle interface (web/) : fenêtres Radix (role=dialog), sélecteurs Popover + Command.
// Les écrans arrivent lot par lot : les méthodes s'appuient sur les rôles et noms
// accessibles, et sur data-testid là où le DOM l'impose.
import type { Locator, Page } from "@playwright/test";

import type { CloseHow, DialogName, UiAdapter } from "./index";

const TITLES: Record<DialogName, string> = {
  settings: "Réglages",
  connections: "Connexions",
  agents: "Agents",
  knowledge: "Fiches",
  "rag-projects": "Projets du RAG intégré",
  rehearsal: "Répéter une présentation",
};

export class NextAdapter implements UiAdapter {
  constructor(readonly page: Page) {}

  async goto() {
    await this.page.goto("./");
    await this.page.locator("[data-testid=app]").waitFor();
  }

  dialog(name: DialogName): Locator {
    return this.page.getByRole("dialog", { name: TITLES[name] });
  }

  async openDialog(name: DialogName) {
    await this.page.getByRole("button", { name: TITLES[name] }).first().click();
    await this.dialog(name).waitFor();
  }

  async closeDialog(name: DialogName, how: CloseHow) {
    if (how === "escape") {
      await this.page.keyboard.press("Escape");
    } else if (how === "outside") {
      await this.page.mouse.click(5, 5);
    } else {
      await this.dialog(name)
        .getByRole("button", { name: /Fermer|Annuler/ })
        .first()
        .click();
    }
  }

  async isDialogOpen(name: DialogName) {
    return (await this.dialog(name).count()) > 0;
  }

  private async pick(label: string, name: string) {
    await this.page
      .getByRole("button", { name: new RegExp(label, "i") })
      .first()
      .click();
    await this.page.getByRole("combobox").fill(name);
    await this.page.getByRole("option", { name }).first().click();
  }

  async pickAgent(name: string) {
    await this.pick("Agent", name);
  }

  async pickMode(name: string) {
    await this.pick("Mode", name);
  }

  async toggleTheme() {
    await this.page.getByRole("button", { name: /Thème/ }).click();
  }

  callButton(): Locator {
    return this.page.getByTestId("call");
  }

  async startCall() {
    await this.callButton().click();
  }

  async hangUp() {
    await this.callButton().click();
  }

  async callState() {
    return (
      (await this.page.getByTestId("app").getAttribute("data-state")) ??
      undefined
    );
  }

  status(): Locator {
    return this.page.getByTestId("status");
  }

  composer(): Locator {
    return this.page.getByTestId("composer-text");
  }

  async sendText(text: string) {
    await this.composer().fill(text);
    await this.page.getByRole("button", { name: "Envoyer" }).click();
  }

  async addToContext(text: string) {
    await this.composer().fill(text);
    await this.page
      .getByRole("button", { name: "Ajouter au contexte" })
      .click();
  }

  subtitles(): Locator {
    return this.page.getByTestId("subtitles");
  }

  lastAssistantLine(): Locator {
    return this.page.getByTestId("line-assistant").last();
  }
}
