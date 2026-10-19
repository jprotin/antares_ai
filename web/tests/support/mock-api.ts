// API simulée (projet chromium-mock) : réponses GET relevées sur la vraie API puis
// assainies (tests/fixtures/api), état en mémoire réinitialisé à chaque test. Les
// écritures sont notées pour que le test vérifie méthode et corps.
import { readFileSync } from "node:fs";

import type { Page, Route } from "@playwright/test";

const FIXTURES = new URL("../fixtures/api/", import.meta.url);

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES), "utf8"));
}

export type Recorded = { method: string; path: string; body: unknown };

type Handler = (route: Route, recorded: Recorded) => Promise<void> | void;

export class MockApi {
  readonly calls: Recorded[] = [];
  private readonly state: Record<string, unknown> = {
    net: fixture("net"),
    documents: fixture("documents"),
    settings: fixture("settings"),
    agents: fixture("agents"),
    "agents/meta": fixture("agents_meta"),
    modes: fixture("modes"),
    models: fixture("models"),
    projects: fixture("projects"),
    rehearsals: fixture("rehearsals"),
    connections: fixture("connections"),
  };
  private readonly overrides: { pattern: RegExp; handler: Handler }[] = [];

  constructor(private readonly page: Page) {}

  // Remplace la réponse d'un appel (« METHODE /api/chemin », expression régulière)
  on(pattern: RegExp, handler: Handler) {
    this.overrides.unshift({ pattern, handler });
    return this;
  }

  set(name: string, value: unknown) {
    this.state[name] = value;
  }

  writes(): Recorded[] {
    return this.calls.filter((call) => call.method !== "GET");
  }

  async install() {
    await this.page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      let body: unknown = null;
      const raw = request.postData();
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      const recorded = { method: request.method(), path, body };
      this.calls.push(recorded);
      const key = `${recorded.method} ${path}`;
      const override = this.overrides.find(({ pattern }) => pattern.test(key));
      if (override) return override.handler(route, recorded);
      const name = path.replace(/^\/api\//, "");
      if (recorded.method === "GET" && name in this.state) {
        return route.fulfill({ json: this.state[name] });
      }
      if (recorded.method === "GET") return route.fulfill({ json: [] });
      if (recorded.method === "PUT" && name === "settings") {
        this.state.settings = {
          ...(this.state.settings as object),
          ...(recorded.body as object),
        };
        return route.fulfill({ json: this.state.settings });
      }
      // Écriture acceptée : l'objet envoyé est renvoyé (les fenêtres attendent du JSON)
      return route.fulfill({ json: recorded.body ?? {} });
    });
    return this;
  }
}
