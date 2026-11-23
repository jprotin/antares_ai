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
    // Veille IA et météo (nouvelle interface) ; GET /api/veille?date= : `[]` par défaut
    "veille/latest": fixture("veille_latest"),
    "veille/prompt": fixture("veille_prompt"),
    "veille/sources": fixture("veille_sources"),
    "veille/others": fixture("veille_others"),
    "veille/stats": fixture("veille_stats"),
    // Droits sur la veille : accès complet (invité d'un partage : read_only)
    "veille/access": { read_only: false, sharing: false },
    // Journal de la veille : aucun en cours
    "veille/journal": { active: false },
    // Présidentielle 2027 : sortie du routeur sur le jeu fictif (lot 1 ; quiz : lot 3)
    presidentielle: fixture("presidentielle"),
    "presidentielle/meta": fixture("presidentielle_meta"),
    "presidentielle/quiz": fixture("presidentielle_quiz"),
  };
  // Veille : prompts d'idées fabriqués pendant le test (POST), en plus de ceux que le
  // dernier passage annonce (`has_prompt`)
  private readonly veillePrompts = new Set<string>();
  // Passage manuel simulé : POST → pending ; relecture suivante → done, un article de
  // plus dans le dernier passage
  private veilleRun: "idle" | "pending" | "done" = "idle";
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
      // Comme le routeur (write_guard.py) : écriture sans en-tête X-Antares refusée
      if (
        recorded.method !== "GET" &&
        (await request.headerValue("x-antares")) !== "1"
      ) {
        return route.fulfill({
          status: 403,
          json: { detail: "Requête refusée : en-tête X-Antares manquant" },
        });
      }
      const key = `${recorded.method} ${path}`;
      const override = this.overrides.find(({ pattern }) => pattern.test(key));
      if (override) return override.handler(route, recorded);
      const veille = this.veille(recorded);
      if (veille) return route.fulfill(veille);
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

  // Routes de la veille : vote (corps renvoyé avec voted_at), prompt d'une idée (GET : 404
  // tant qu'il n'est pas fabriqué ; POST : fabriqué, puis servi depuis le cache)
  private veille({ method, path, body }: Recorded) {
    const sources = this.veilleSources(method, path, body);
    if (sources) return sources;
    if (path === "/api/veille/run") return this.veilleRunStatus(method);
    const translate = /^\/api\/veille\/article\/([^/]+)\/translate$/.exec(path);
    if (translate?.[1]) return this.veilleTranslate(method, translate[1]);
    if (method === "POST" && path === "/api/veille/vote") {
      const vote = (body ?? {}) as { value?: string };
      return {
        json: {
          ...vote,
          voted_at: vote.value === "none" ? null : "2026-11-16T12:05:09+00:00",
        },
      };
    }
    const match = /^\/api\/veille\/idea\/([^/]+)\/prompt$/.exec(path);
    if (!match?.[1]) return null;
    const id = match[1];
    const latest = this.state["veille/latest"] as {
      run?: { ideas?: { id?: string; has_prompt?: boolean }[] };
    };
    const announced = (latest?.run?.ideas ?? []).some(
      (idea) => idea.id === id && idea.has_prompt,
    );
    const made = announced || this.veillePrompts.has(id);
    const prompt = {
      ...(this.state["veille/prompt"] as object),
      idea_id: id,
      cached: made,
    };
    if (method === "GET")
      return made
        ? { json: prompt }
        : { status: 404, json: { detail: "Prompt pas encore fabriqué" } };
    if (method === "POST") {
      this.veillePrompts.add(id);
      return { json: prompt };
    }
    return null;
  }

  // Traduction d'un article : GET 404 tant qu'elle n'est pas faite, POST la fait
  private readonly veilleTranslations = new Set<string>();

  private veilleTranslate(method: string, id: string) {
    const latest = this.state["veille/latest"] as {
      run: { items: { id: string; title: string; summary?: string }[] };
    };
    const item = latest.run.items.find((i) => i.id === id);
    if (!item) return { status: 404, json: { detail: "Article introuvable" } };
    const answer = {
      article_id: id,
      title: `${item.title} (traduit)`,
      summary: item.summary ? `Extrait traduit : ${item.summary}` : "",
      model: "ollama/gemma4:e4b",
      created_at: "2026-11-17T14:00:00+00:00",
      cached: this.veilleTranslations.has(id),
    };
    if (method === "GET")
      return this.veilleTranslations.has(id)
        ? { json: answer }
        : { status: 404, json: { detail: "Article pas encore traduit" } };
    if (method === "POST") {
      this.veilleTranslations.add(id);
      return { json: answer };
    }
    return null;
  }

  private veilleRunStatus(method: string) {
    const status = (state: string, retry: number) => ({
      state,
      request_id: state === "idle" ? null : 1,
      requested_at: state === "idle" ? null : "2026-11-16T12:10:00+00:00",
      started_at: null,
      finished_at: null,
      run_id: null,
      retry_after: retry,
    });
    if (method === "POST") {
      if (this.veilleRun === "pending")
        return {
          status: 409,
          json: { detail: "Un passage est déjà en cours" },
        };
      this.veilleRun = "pending";
      return { status: 202, json: status("pending", 300) };
    }
    if (method !== "GET") return null;
    if (this.veilleRun === "pending") {
      this.veilleRun = "done";
      const latest = this.state["veille/latest"] as {
        run: { items: Record<string, unknown>[] };
      };
      const first = latest.run.items[0];
      latest.run.items = [
        {
          ...first,
          id: "a0000000000000ff",
          title: "Article du nouveau passage",
          url: "https://exemple.test/nouveau",
        },
        ...latest.run.items,
      ];
    }
    return {
      json: status(this.veilleRun, this.veilleRun === "done" ? 240 : 0),
    };
  }

  // Sources : lecture d'essai (adresse contenant « panne » : 422), ajout (identifiant
  // suivant, adresse du flux = adresse saisie), catégorie, suppression, interrupteurs
  private veilleSources(method: string, path: string, body: unknown) {
    type Sources = {
      builtin: { name: string; enabled: boolean; favorite?: boolean }[];
      custom: {
        id: number;
        name: string;
        category: string;
        favorite?: boolean;
      }[];
    };
    const state = this.state["veille/sources"] as Sources;
    const input = (body ?? {}) as {
      kind?: string;
      url?: string;
      query?: string;
      name?: string;
      lang?: string;
      category?: string;
      enabled?: boolean;
      favorite?: boolean;
    };
    const probe = () => {
      const url =
        input.kind === "search"
          ? `https://news.google.com/rss/search?q=${encodeURIComponent(input.query ?? "")}`
          : (input.url ?? "");
      if (url.includes("panne"))
        return { status: 422, json: { detail: "Lecture impossible : 500" } };
      return {
        json: {
          name:
            input.name ||
            (input.kind === "search"
              ? `${input.query} (Google News)`
              : new URL(url).hostname),
          url,
          articles: 12,
          recent: 4,
          latest: [
            {
              title: "Premier titre",
              published_at: "2026-11-16T10:00:00+00:00",
            },
            {
              title: "Deuxième titre",
              published_at: "2026-11-16T09:00:00+00:00",
            },
          ],
        },
      };
    };
    if (method === "POST" && path === "/api/veille/sources/test")
      return probe();
    if (method === "POST" && path === "/api/veille/sources") {
      const probed = probe();
      if (probed.status) return probed;
      const saved = {
        id: Math.max(0, ...state.custom.map((s) => s.id)) + 1,
        kind: input.kind,
        name: (probed.json as { name: string }).name,
        url: (probed.json as { url: string }).url,
        query: input.kind === "search" ? input.query : "",
        lang: input.lang ?? "fr",
        category: input.category ?? "",
        filter_keywords: false,
        created_at: "2026-11-17T02:00:00+00:00",
        favorite: false,
      };
      state.custom.push(saved);
      return { status: 201, json: saved };
    }
    if (method === "GET" && path === "/api/veille/sources/favorites")
      return {
        json: {
          names: [...state.builtin, ...state.custom]
            .filter((s) => s.favorite)
            .map((s) => s.name),
          max_favorites: 10,
        },
      };
    if (method === "POST" && path === "/api/veille/sources/favorite") {
      const found = [...state.builtin, ...state.custom].find(
        (s) => s.name === input.name,
      );
      if (!found)
        return { status: 404, json: { detail: "Source introuvable" } };
      found.favorite = Boolean(input.favorite);
      return { json: { name: input.name, favorite: found.favorite } };
    }
    if (method === "POST" && path === "/api/veille/sources/builtin") {
      const found = state.builtin.find((s) => s.name === input.name);
      if (found) found.enabled = Boolean(input.enabled);
      return { json: { name: input.name, enabled: input.enabled } };
    }
    const match = /^\/api\/veille\/sources\/(\d+)$/.exec(path);
    if (!match) return null;
    const id = Number(match[1]);
    const index = state.custom.findIndex((s) => s.id === id);
    if (index < 0)
      return { status: 404, json: { detail: "Source introuvable" } };
    if (method === "DELETE") {
      state.custom.splice(index, 1);
      return { status: 204, body: "" };
    }
    if (method === "PATCH") {
      const current = state.custom[index];
      if (current) Object.assign(current, input);
      return { json: current };
    }
    return null;
  }
}
