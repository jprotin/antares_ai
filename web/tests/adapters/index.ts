// Adaptateur par interface (stratégie de tests, 4.3) : absorbe les différences de DOM
// entre l'ancienne interface (frontend/) et la nouvelle (web/). Aucune assertion ici.
import type { Locator, Page } from "@playwright/test";

import { LegacyAdapter } from "./legacy";
import { NextAdapter } from "./next";

export type DialogName =
  | "settings"
  | "connections"
  | "agents"
  | "knowledge"
  | "rag-projects"
  | "rehearsal";
export type CloseHow = "escape" | "outside" | "button";
export type CallState =
  | "idle"
  | "connecting"
  | "listening"
  | "user"
  | "thinking"
  | "speaking";

export interface UiAdapter {
  readonly page: Page;
  goto(): Promise<void>;
  dialog(name: DialogName): Locator;
  openDialog(name: DialogName): Promise<void>;
  closeDialog(name: DialogName, how: CloseHow): Promise<void>;
  isDialogOpen(name: DialogName): Promise<boolean>;
  pickAgent(name: string): Promise<void>;
  pickMode(name: string): Promise<void>;
  toggleTheme(): Promise<void>;
  callButton(): Locator;
  startCall(): Promise<void>;
  hangUp(): Promise<void>;
  callState(): Promise<string | undefined>;
  status(): Locator;
  composer(): Locator;
  sendText(text: string): Promise<void>;
  addToContext(text: string): Promise<void>;
  subtitles(): Locator;
  lastAssistantLine(): Locator;
}

export function adapterFor(page: Page): UiAdapter {
  return process.env.ANTARES_UI === "next"
    ? new NextAdapter(page)
    : new LegacyAdapter(page);
}
