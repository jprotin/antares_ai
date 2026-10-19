// Fixtures automatiques de tous les tests de bout en bout (stratégie de tests, 4.2) :
// - garde hors ligne : toute requête vers une autre origine que la page fait échouer ;
// - collecteur CSP : toute violation fait échouer (sauf amélioration attendue en KO) ;
// - erreurs JS : pageerror toujours fatal, console.error fatal sauf liste du test ;
// - garde d'écriture (projet chromium-live) : seules les écritures tolérées passent.
import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { adapterFor, type UiAdapter } from "../adapters";

export type CspViolation = {
  directive: string;
  blocked: string;
  source: string;
  line: number;
  sample: string;
};

// Écritures tolérées sur la vraie API (stratégie, 9.2) : aucune ne modifie des données durables
const ALLOWED_WRITES = [
  /^POST \/api\/chat$/,
  /^POST \/api\/web\/tags$/,
  /^DELETE \/api\/rehearsals\/live$/,
  /^PUT \/api\/rehearsals\/live$/,
];

export type GuardOptions = {
  // Messages console.error attendus pour ce test (sous-chaîne)
  allowConsoleErrors: string[];
  // Violations CSP tolérées sur l'ancienne interface (ligne « amélioration » en KO attendu)
  allowLegacyCsp: boolean;
};

type Fixtures = GuardOptions & {
  ui: UiAdapter;
  guards: Guards;
};

export class Guards {
  foreign: string[] = [];
  pageErrors: string[] = [];
  consoleErrors: string[] = [];
  refusedWrites: string[] = [];

  constructor(private readonly page: Page) {}

  async csp(): Promise<CspViolation[]> {
    if (this.page.isClosed()) return [];
    return this.page.evaluate(
      () => (window as unknown as { __csp?: CspViolation[] }).__csp ?? [],
    );
  }
}

// Projets qui parlent à la vraie API (pas à l'API simulée) : la garde d'écriture s'applique
const REAL_API_PROJECTS = new Set(["chromium-live", "smoke", "perf"]);

// Garde d'écriture au niveau du contexte (toutes ses pages, popups comprises) : seules les
// écritures tolérées atteignent la vraie API ; les autres sont refusées et notées
export async function guardWrites(context: BrowserContext, refused: string[]) {
  await context.route("**/api/**", (route) => {
    const request = route.request();
    if (request.method() === "GET" || request.method() === "HEAD")
      return route.fallback();
    const key = `${request.method()} ${new URL(request.url()).pathname}`;
    if (ALLOWED_WRITES.some((pattern) => pattern.test(key)))
      return route.fallback();
    refused.push(key);
    return route.abort("accessdenied");
  });
}

export function isLegacy(): boolean {
  return process.env.ANTARES_UI !== "next";
}

async function installCspCollector(page: Page) {
  await page.addInitScript(() => {
    const store: unknown[] = [];
    (window as unknown as { __csp: unknown[] }).__csp = store;
    document.addEventListener("securitypolicyviolation", (event) =>
      store.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
        source: event.sourceFile,
        line: event.lineNumber,
        sample: event.sample,
      }),
    );
  });
}

function sameOrigin(url: string, origin: string): boolean {
  if (
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.startsWith("about:")
  )
    return true;
  return new URL(url).origin === origin;
}

export const test = base.extend<Fixtures>({
  allowConsoleErrors: [[], { option: true }],
  allowLegacyCsp: [false, { option: true }],

  guards: [
    async (
      { page, baseURL, allowConsoleErrors, allowLegacyCsp },
      use,
      testInfo: TestInfo,
    ) => {
      const origin = new URL(baseURL ?? "http://127.0.0.1:8765/").origin;
      const guards = new Guards(page);
      await installCspCollector(page);

      page.on("request", (request) => {
        if (!sameOrigin(request.url(), origin))
          guards.foreign.push(request.url());
      });
      page.on("websocket", (ws) => {
        const url = ws.url().replace(/^ws/, "http");
        if (!sameOrigin(url, origin)) guards.foreign.push(ws.url());
      });
      page.on("pageerror", (error) => guards.pageErrors.push(String(error)));
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        // Les violations CSP passent par le collecteur ; les échecs de ressources par la garde
        if (/Content.Security.Policy/i.test(text)) return;
        if (allowConsoleErrors.some((allowed) => text.includes(allowed)))
          return;
        guards.consoleErrors.push(text);
      });

      if (testInfo.project.name === "offline-strict") {
        await page.route("**/*", (route) =>
          sameOrigin(route.request().url(), origin)
            ? route.fallback()
            : route.abort("blockedbyclient"),
        );
      }
      if (REAL_API_PROJECTS.has(testInfo.project.name))
        await guardWrites(page.context(), guards.refusedWrites);

      await use(guards);

      const csp = await guards.csp().catch(() => []);
      const tolerated = allowLegacyCsp && isLegacy();
      expect.soft(guards.foreign, "requêtes hors origine").toEqual([]);
      expect.soft(guards.pageErrors, "erreurs JS (pageerror)").toEqual([]);
      expect
        .soft(guards.consoleErrors, "console.error non attendus")
        .toEqual([]);
      expect
        .soft(guards.refusedWrites, "écritures refusées par la garde")
        .toEqual([]);
      if (!tolerated) expect.soft(csp, "violations CSP").toEqual([]);
    },
    { auto: true },
  ],

  ui: async ({ page }, use) => {
    await use(adapterFor(page));
  },
});

export { expect };
