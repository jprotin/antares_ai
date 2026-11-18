// Interface web/ : ossature à menu de gauche, écrans en pages (zone nommée), sélecteurs
// Popover + Command. Les méthodes s'appuient sur
// les rôles et noms accessibles, et sur data-testid là où le DOM l'impose.
import type { Locator, Page } from "@playwright/test";

import { openPage } from "../support/menu";

import type { DialogName, UiAdapter } from "./index";

const TITLES: Record<DialogName, string> = {
  settings: "Réglages",
  connections: "Connexions",
  agents: "Agents",
  knowledge: "Connaissances",
  "rag-projects": "Projets du RAG intégré",
  rehearsal: "Répéter une présentation",
};

// Pages de l'ossature (menu de gauche) : entrée du menu, sous-entrée éventuelle
const PAGES: Record<
  DialogName,
  { entry: string; sub?: string; route: string }
> = {
  settings: { entry: "Réglages", sub: "Général", route: "reglages/general" },
  connections: {
    entry: "Réglages",
    sub: "Connexions",
    route: "reglages/connexions",
  },
  agents: { entry: "Réglages", sub: "Agents", route: "reglages/agents" },
  knowledge: {
    entry: "Réglages",
    sub: "Connaissances",
    route: "reglages/connaissances",
  },
  "rag-projects": {
    entry: "Réglages",
    sub: "Projets RAG",
    route: "reglages/projets-rag",
  },
  rehearsal: { entry: "Répétition", route: "repetition" },
};

export class NextAdapter implements UiAdapter {
  constructor(readonly page: Page) {}

  // Page Conversation (l'accueil est le tableau de bord)
  async goto() {
    await this.page.goto("./#/conversation");
    await this.page.locator("[data-testid=app]").waitFor();
  }

  dialog(name: DialogName): Locator {
    return this.page.getByRole("region", { name: TITLES[name], exact: true });
  }

  async openDialog(name: DialogName) {
    const { entry, sub } = PAGES[name];
    await openPage(this.page, entry, sub);
    await this.dialog(name).waitFor();
  }

  // Une page ne se ferme pas : retour à la Conversation
  async closeDialog() {
    await openPage(this.page, "Conversation");
  }

  async waitApplied() {
    await this.dialog("settings")
      .getByRole("status")
      .filter({ hasText: "Réglages appliqués." })
      .waitFor();
  }

  async isDialogOpen(name: DialogName) {
    return (await this.dialog(name).count()) > 0;
  }

  private async pick(label: string, name: string) {
    await this.page
      .getByRole("button", { name: new RegExp(label, "i") })
      .first()
      .click();
    // Recherche seulement pour l'agent
    const search = this.page.getByRole("combobox");
    if (await search.count()) await search.fill(name);
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

  halfDuplex(): Locator {
    return this.page.getByRole("checkbox", {
      name: /Couper mon micro pendant la réponse/,
    });
  }

  netIndicator(): Locator {
    return this.page.getByTestId("net");
  }

  attachInput(): Locator {
    return this.page.getByTestId("attach-input");
  }

  attachments(): Locator {
    return this.page.getByTestId("attachment");
  }
}
