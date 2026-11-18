// Veille IA et météo (nouvelle interface seulement) en mock : pastille, fenêtre plein
// écran sans défilement horizontal, navigation, erreurs, partage public, sécurité du
// contenu des flux (E-01 à E-24), puis refonte : grande météo, filtres, votes, idées et
// prompt copiable, grille responsive, thèmes clair et sombre (E-30 à E-45), sources
// (E-50 à E-55), fiche d'article, « Tous les articles », sources privilégiées et passage
// manuel (E-60 à E-66).
import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";

import { openPage } from "../support/menu";
import { MockApi } from "../support/mock-api";
import { expect, isLegacy, test } from "../support/test";

const LATEST = JSON.parse(
  readFileSync(
    new URL("../fixtures/api/veille_latest.json", import.meta.url),
    "utf8",
  ),
);
const PROMPT = JSON.parse(
  readFileSync(
    new URL("../fixtures/api/veille_prompt.json", import.meta.url),
    "utf8",
  ),
);
const STATS = JSON.parse(
  readFileSync(
    new URL("../fixtures/api/veille_stats.json", import.meta.url),
    "utf8",
  ),
);
const NET = JSON.parse(
  readFileSync(new URL("../fixtures/api/net.json", import.meta.url), "utf8"),
);
const STORAGE_KEY = "antares.veille.lastOpened";
const RUN = LATEST.run;

type Run = typeof RUN;
type Item = (typeof RUN.items)[number];

// Écritures de la veille seulement (l'interface en fait d'autres au chargement)
const veilleWrites = (api: MockApi) =>
  api.writes().filter((call) => call.path.startsWith("/api/veille"));

function withRun(changes: Partial<Run>) {
  return { ...LATEST, run: { ...RUN, ...changes } };
}

// Article de schéma 2 (identifiant à 16 caractères hexadécimaux)
function article(changes: Partial<Item>): Item {
  return { ...RUN.items[1], vote: null, ...changes };
}

// Dernière ouverture à 9 h (avant le passage de 13 h), posée une seule fois : un
// rechargement garde la date écrite par l'interface
async function openedAt9(page: Page) {
  await page.addInitScript((key) => {
    if (!localStorage.getItem(key))
      localStorage.setItem(key, "2026-11-16T08:00:00.000Z");
  }, STORAGE_KEY);
}

// Page Actualités (menu de gauche), pastille de son entrée
const button = (page: Page) =>
  page
    .locator('[data-slot="sidebar"]')
    .getByRole("link", { name: "Actualités", exact: true });
const dialog = (page: Page) =>
  page.getByRole("region", { name: "Veille IA et météo", exact: true });
const badge = (page: Page) => page.getByTestId("veille-fresh");

// Quitte la page Actualités (retour à la Conversation)
async function closeVeille(page: Page) {
  await openPage(page, "Conversation");
  await expect(dialog(page)).toHaveCount(0);
}

async function openVeille(page: Page) {
  await openPage(page, "Actualités");
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator(".veille__body")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}

// Aucun défilement horizontal dans la fenêtre, et la page n'en gagne pas à l'ouverture
// (la grille de la page déborde déjà de quelques pixels à 375 px, hors de cette feature)
async function rootScrollWidth(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth);
}

async function noHorizontalScroll(page: Page, before: number) {
  const sizes = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>("#veille");
    return {
      root: document.documentElement.scrollWidth,
      panel: panel ? [panel.scrollWidth, panel.clientWidth] : [1, 0],
    };
  });
  expect(sizes.root).toBeLessThanOrEqual(before);
  expect(sizes.panel[0]).toBeLessThanOrEqual(sizes.panel[1] ?? 0);
}

test.describe("veille IA et météo @mock @veille", () => {
  test.skip(isLegacy(), "veille absente de l'ancienne interface");
  // Fenêtre mesurée sans l'animation d'ouverture (mise à l'échelle)
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test.describe("pastille", () => {
    test("E-01 : passage de 13 h, ouverture à 9 h, pastille visible", async ({
      page,
      ui,
    }) => {
      await openedAt9(page);
      await new MockApi(page).install();
      await ui.goto();
      await expect(badge(page)).toBeVisible();
      await expect(badge(page)).toHaveText("Nouvelle veille disponible");
    });

    test("E-02 : ouvrir puis fermer efface la pastille, même après rechargement", async ({
      page,
      ui,
    }) => {
      await openedAt9(page);
      await new MockApi(page).install();
      await ui.goto();
      await expect(badge(page)).toBeVisible();
      await openVeille(page);
      await closeVeille(page);
      await expect(badge(page)).toHaveCount(0);
      await page.reload();
      await page.getByTestId("app").waitFor();
      await expect(button(page)).toBeVisible();
      await expect(badge(page)).toHaveCount(0);
    });

    test("E-03 : jamais ouverte, pastille visible", async ({ page, ui }) => {
      await new MockApi(page).install();
      await ui.goto();
      await expect(badge(page)).toBeVisible();
    });

    test("E-04 : stockage indisponible, pastille visible et fenêtre ouverte", async ({
      page,
      ui,
    }) => {
      await page.addInitScript(() => {
        const fail = () => {
          throw new Error("stockage indisponible");
        };
        Storage.prototype.getItem = fail;
        Storage.prototype.setItem = fail;
      });
      await new MockApi(page).install();
      await ui.goto();
      await expect(badge(page)).toBeVisible();
      await openVeille(page);
    });

    test("E-05 : nouveau passage relevé 5 minutes plus tard, la pastille revient", async ({
      page,
      ui,
    }) => {
      await page.clock.install();
      const api = await new MockApi(page).install();
      await ui.goto();
      await openVeille(page);
      await closeVeille(page);
      await expect(badge(page)).toHaveCount(0);
      const later = new Date(Date.now() + 3_600_000).toISOString();
      api.set("veille/latest", withRun({ id: 4, finished_at: later }));
      await page.clock.fastForward(5 * 60_000 + 1000);
      await expect(badge(page)).toBeVisible();
    });

    test("E-06 : passage en échec allume, créneau manqué seul non", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page).install();
      api.set("veille/latest", withRun({ status: "failed" }));
      await openedAt9(page);
      await ui.goto();
      await expect(badge(page)).toBeVisible();

      api.set("veille/latest", { ...LATEST, run: null });
      await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
      await page.reload();
      await page.getByTestId("app").waitFor();
      await expect(button(page)).toBeVisible();
      await expect(badge(page)).toHaveCount(0);
    });
  });

  test.describe("page pleine largeur", () => {
    for (const [width, height] of [
      [375, 667],
      [768, 1024],
      [1440, 900],
    ] as const) {
      test(`E-10/E-11 : ${width} × ${height}, toute la largeur de la page sans défilement horizontal`, async ({
        page,
        ui,
      }) => {
        await page.setViewportSize({ width, height });
        await new MockApi(page).install();
        await ui.goto();
        const before = await rootScrollWidth(page);
        await openVeille(page);
        await noHorizontalScroll(page, before);
        // Toute la largeur de la page (à droite du menu)
        const box = await dialog(page).boundingBox();
        const area = await page.locator(".shell__page").boundingBox();
        expect(
          Math.abs((box?.width ?? 0) - (area?.width ?? 0)),
        ).toBeLessThanOrEqual(1);
        // Contenu centré dans la page, largeur bornée
        const body = await page.locator(".veille__body").boundingBox();
        expect(body?.width ?? 0).toBeLessThanOrEqual(76 * 16 + 1);
        const left = (body?.x ?? 0) - (area?.x ?? 0);
        const right = (area?.width ?? 0) - left - (body?.width ?? 0);
        expect(Math.abs(left - right)).toBeLessThanOrEqual(20);
      });
    }

    test("E-12 : adresse et titre de 300 caractères sans espace", async ({
      page,
      ui,
    }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      const long = `https://example.com/${"a".repeat(280)}`;
      const api = await new MockApi(page).install();
      api.set(
        "veille/latest",
        withRun({
          items: [
            article({
              id: "ffffffffffffffff",
              title: long,
              url: long,
              source: long,
              sentence: long,
            }),
            ...RUN.items,
          ],
        }),
      );
      await ui.goto();
      const before = await rootScrollWidth(page);
      await openVeille(page);
      await expect(
        dialog(page).locator(".veille-card").getByText(long).first(),
      ).toBeVisible();
      await noHorizontalScroll(page, before);
    });

    test("E-13 : météo, actualités, idées et heure du passage", async ({
      page,
      ui,
    }) => {
      await new MockApi(page).install();
      await ui.goto();
      await openVeille(page);
      const panel = dialog(page);
      await expect(
        panel.getByRole("heading", { name: /^Météo/ }),
      ).toBeVisible();
      await expect(panel.locator(".veille-weather")).toContainText("Pluie");
      await expect(panel.locator(".veille-weather")).toContainText("10 °C");
      await expect(panel.locator(".veille-weather")).toContainText(
        "Le Pellerin",
      );
      await expect(
        panel.getByRole("heading", { name: "Actualités (20)" }),
      ).toBeVisible();
      await expect(
        panel.getByRole("button", { name: RUN.items[0].title, exact: true }),
      ).toBeVisible();
      await expect(panel).toContainText(RUN.items[0].sentence);
      await expect(panel.getByTestId("veille-article")).toHaveCount(20);
      await expect(panel.getByTestId("veille-count")).toHaveText("20 articles");
      await expect(
        panel.getByRole("heading", { name: "Idées pour Antares (6)" }),
      ).toBeVisible();
      await expect(panel.getByTestId("veille-idea")).toHaveCount(6);
      await expect(panel).toContainText(RUN.ideas[0].benefit);
      await expect(panel).toContainText(RUN.ideas[0].first_step);
      await expect(panel).toContainText("Effort moyen");
      await expect(page.getByTestId("veille-when")).toHaveText(
        "Passage de 13:00 · 1/1",
      );
    });

    test("E-14 : erreurs en lignes courtes", async ({ page, ui }) => {
      const api = await new MockApi(page).install();
      await ui.goto();
      await openVeille(page);
      await expect(dialog(page).locator(".veille__errors li")).toHaveText([
        "Flux Hacker News indisponible",
      ]);
      await closeVeille(page);
      api.set(
        "veille/latest",
        withRun({
          status: "failed",
          items: [],
          ideas: [],
          errors: [
            "Flux Hacker News indisponible",
            "Veille indisponible : réponse du modèle illisible",
          ],
        }),
      );
      await page.reload();
      await page.getByTestId("app").waitFor();
      await openVeille(page);
      await expect(dialog(page).locator(".veille__errors li")).toHaveText([
        "Flux Hacker News indisponible",
        "Veille indisponible : réponse du modèle illisible",
      ]);
      await expect(page.getByTestId("veille-when")).toContainText("en échec");
    });

    test("E-15 : passage vide, « Rien de notable »", async ({ page, ui }) => {
      const api = await new MockApi(page).install();
      api.set("veille/latest", withRun({ items: [], ideas: [], errors: [] }));
      await ui.goto();
      await openVeille(page);
      await expect(dialog(page).getByText("Rien de notable")).toBeVisible();
    });

    test("E-16 : navigation entre passages, toute la journée, autre jour", async ({
      page,
      ui,
    }) => {
      const dates: string[] = [];
      const morning = {
        ...RUN,
        id: 2,
        finished_at: "2026-11-16T07:00:40+00:00",
        items: [
          { ...RUN.items[1], title: "Passage du matin" },
          {
            ...RUN.items[1],
            id: "a0000000000000aa",
            title: "Passage du matin",
          },
        ],
      };
      const api = await new MockApi(page)
        .on(/^GET \/api\/veille$/, (route) => {
          const date = new URL(route.request().url()).searchParams.get("date");
          dates.push(date ?? "");
          const runs =
            date === "2026-11-16"
              ? [morning, RUN]
              : [{ ...RUN, id: 1, day: date, items: [] }];
          return route.fulfill({
            json: { weather: null, runs, missed: [] },
          });
        })
        .install();
      await ui.goto();
      await openVeille(page);
      const when = page.getByTestId("veille-when");
      const cards = dialog(page).getByTestId("veille-article");
      await expect(when).toContainText("2/2");
      await expect(cards).toHaveCount(20);
      await dialog(page)
        .getByRole("button", { name: "Passage précédent" })
        .click();
      await expect(when).toContainText("Passage de 08:00");
      await expect(cards).toHaveCount(2);
      await expect(dialog(page)).toContainText("Passage du matin");
      await dialog(page)
        .getByRole("button", { name: "Passage suivant" })
        .click();
      await expect(when).toContainText("2/2");
      // Toute la journée : les deux passages, le plus récent d'abord, sans doublon
      const whole = dialog(page).getByRole("button", {
        name: "Toute la journée",
      });
      await whole.click();
      await expect(whole).toHaveAttribute("aria-pressed", "true");
      await expect(when).toHaveText(
        "Toute la journée · 2 passages · dernier à 13:00",
      );
      await expect(cards).toHaveCount(21);
      await expect(cards.last()).toContainText("Passage du matin");
      await dialog(page)
        .getByRole("button", { name: "Passage précédent" })
        .click();
      await expect(when).toContainText("2/2");
      await dialog(page)
        .getByRole("combobox", { name: "Jour" })
        .selectOption("2026-11-15");
      await expect(dialog(page).getByText("Rien de notable")).toBeVisible();
      expect(dates).toEqual(["2026-11-16", "2026-11-15"]);
      expect(
        api.calls.filter((call) => call.path === "/api/veille").length,
      ).toBe(2);
    });

    test("E-17 : météo absente", async ({ page, ui }) => {
      const api = await new MockApi(page).install();
      api.set("veille/latest", { ...LATEST, weather: null });
      await ui.goto();
      await openVeille(page);
      await expect(
        dialog(page).getByText("Météo non relevée pour ce passage"),
      ).toBeVisible();
    });

    test("E-17b : ancienne ligne météo, texte d'origine sans dessin", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page).install();
      api.set("veille/latest", {
        ...LATEST,
        weather: {
          day: "2026-11-16",
          text: "Le Pellerin : 6 à 12 °C, pluie 40 %",
          fetched_at: "2026-11-16T07:00:02+00:00",
        },
      });
      await ui.goto();
      await openVeille(page);
      await expect(dialog(page)).toContainText(
        "Le Pellerin : 6 à 12 °C, pluie 40 %",
      );
      await expect(dialog(page).locator(".weather-art")).toHaveCount(0);
    });

    test("E-18 : en-tête collant en haut de la page", async ({ page, ui }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await new MockApi(page).install();
      await ui.goto();
      await openVeille(page);
      await page.locator(".shell__page").evaluate((scroller) => {
        scroller.scrollTop = scroller.scrollHeight;
      });
      const header = await page.locator(".veille__header").boundingBox();
      const bar = await page
        .locator('[data-slot="sidebar-inset"] > header')
        .boundingBox();
      expect(
        Math.abs((header?.y ?? 99) - ((bar?.y ?? 0) + (bar?.height ?? 0))),
      ).toBeLessThanOrEqual(1);
      await expect(
        dialog(page).getByRole("button", { name: "Nouveau passage" }),
      ).toBeInViewport();
    });

    test("E-19 : dernier passage réussi et créneaux manqués", async ({
      page,
      ui,
    }) => {
      await new MockApi(page).install();
      await ui.goto();
      await openVeille(page);
      await expect(dialog(page)).toContainText("Dernier passage réussi :");
      await expect(dialog(page)).toContainText(/Créneaux manqués : .*08:00/);
    });
  });

  test.describe("sécurité et partage public", () => {
    test("E-20 : partage public, invité en lecture seule", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page)
        .on(/^GET \/api\/veille\/access$/, (route) =>
          route.fulfill({ json: { read_only: true, sharing: true } }),
        )
        .install();
      api.set("net", { ...NET, sharing: true });
      await ui.goto();
      await openVeille(page);
      const panel = dialog(page);
      await expect(page.getByTestId("veille-readonly")).toHaveText(
        "Lecture seule",
      );
      await expect(panel.getByTestId("veille-article")).toHaveCount(20);
      // Actions masquées : passage, sources, votes, étoile
      await expect(
        panel.getByRole("button", { name: "Nouveau passage", exact: true }),
      ).toHaveCount(0);
      await expect(panel.getByRole("button", { name: "Sources" })).toHaveCount(
        0,
      );
      await expect(panel.locator(".veille-vote")).toHaveCount(0);
      await expect(
        panel.getByRole("button", { name: /^Intéressé/ }),
      ).toHaveCount(0);
      await expect(
        panel.getByRole("button", { name: "Statistiques" }),
      ).toBeVisible();
      await panel
        .getByRole("button", { name: RUN.items[0].title, exact: true })
        .click();
      const sheet = page.getByTestId("veille-article-dialog");
      await expect(sheet.getByRole("link")).toBeVisible();
      await expect(sheet.locator(".veille-vote")).toHaveCount(0);
      await expect(
        sheet.getByRole("button", { name: "Privilégier cette source" }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      await panel.getByRole("tab", { name: /Tous les articles/ }).click();
      await expect(panel.getByTestId("veille-other")).toHaveCount(50);
      await expect(panel.locator(".veille-other .veille-vote")).toHaveCount(0);
      expect(
        api.writes().filter((c) => c.path.startsWith("/api/veille")),
      ).toEqual([]);
    });

    test("E-20b : partage ouvert en cours de session, bouton gardé", async ({
      page,
      ui,
    }) => {
      await page.clock.install();
      const api = await new MockApi(page).install();
      await ui.goto();
      await expect(button(page)).toBeVisible();
      api.set("net", { ...NET, sharing: true });
      await page.clock.fastForward(15_000);
      await expect(button(page)).toBeVisible();
      // Propriétaire (ou accès local) : tout reste disponible
      await openVeille(page);
      await expect(page.getByTestId("veille-readonly")).toHaveCount(0);
      await expect(
        dialog(page).getByRole("button", {
          name: "Nouveau passage",
          exact: true,
        }),
      ).toBeVisible();
    });

    test("E-21 : liens externes dans un nouvel onglet, sans référent", async ({
      page,
      ui,
    }) => {
      await new MockApi(page).install();
      await ui.goto();
      await openVeille(page);
      const links = dialog(page).locator(".veille-card a, .veille-idea a");
      await expect(links.first()).toBeVisible();
      for (const link of await links.all()) {
        await expect(link).toHaveAttribute("target", "_blank");
        const rel = (await link.getAttribute("rel")) ?? "";
        expect(rel.split(" ")).toEqual(
          expect.arrayContaining(["noopener", "noreferrer"]),
        );
      }
    });

    test("E-22 : lien javascript: affiché en texte, sans lien", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page).install();
      api.set(
        "veille/latest",
        withRun({
          items: [
            article({
              title: "Lien piégé",
              url: "javascript:alert(1)",
              source: "Hostile",
              sentence: "Ne doit pas devenir un lien.",
            }),
          ],
          ideas: [],
        }),
      );
      await ui.goto();
      await openVeille(page);
      await expect(dialog(page).getByText("Lien piégé")).toBeVisible();
      await expect(dialog(page).locator(".veille-card a")).toHaveCount(0);
      await expect(dialog(page).locator('a[href^="javascript"]')).toHaveCount(
        0,
      );
    });

    test("E-23 : titre HTML affiché littéralement", async ({ page, ui }) => {
      const hostile = '<img src=x onerror="window.__pwned=1">';
      const api = await new MockApi(page).install();
      api.set(
        "veille/latest",
        withRun({
          items: [
            article({
              title: hostile,
              url: "https://example.com/a",
              source: "Hostile",
              sentence: "<b>gras</b>",
            }),
          ],
        }),
      );
      await ui.goto();
      await openVeille(page);
      await expect(dialog(page).getByText(hostile)).toBeVisible();
      await expect(dialog(page).getByText("<b>gras</b>")).toBeVisible();
      await expect(dialog(page).locator("img, b")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => (window as unknown as { __pwned?: number }).__pwned,
        ),
      ).toBeUndefined();
    });

    test.describe("réponses refusées", () => {
      // Le navigateur journalise l'échec de la ressource (403, 404)
      test.use({ allowConsoleErrors: ["Failed to load resource"] });
      for (const [name, reply] of [
        ["403", { status: 403, json: { detail: "partage" } }],
        ["404", { status: 404, json: { detail: "Not Found" } }],
        ["[]", { json: [] }],
      ] as const) {
        test(`E-24 : réponse ${name}, bouton présent sans pastille`, async ({
          page,
          ui,
        }) => {
          await new MockApi(page)
            .on(/^GET \/api\/veille\/latest$/, (route) => route.fulfill(reply))
            .install();
          await ui.goto();
          await expect(button(page)).toBeVisible();
          await expect(badge(page)).toHaveCount(0);
          await openVeille(page);
          await expect(dialog(page)).toContainText(
            "Aucune veille pour l'instant",
          );
        });
      }
    });
  });

  test.describe("refonte : météo, filtres, votes, idées", () => {
    const articles = (page: Page) => dialog(page).getByTestId("veille-article");
    const count = (page: Page) => dialog(page).getByTestId("veille-count");
    const ideaCard = (page: Page, index: number) =>
      dialog(page).getByTestId("veille-idea").nth(index);
    const promptDialog = (page: Page) =>
      page.getByRole("dialog", { name: RUN.ideas[0].title });

    test("E-30 : grande météo illustrée et frise de 12 heures", async ({
      page,
      ui,
    }) => {
      await new MockApi(page).install();
      await ui.goto();
      await openVeille(page);
      const weather = dialog(page).locator(".veille-weather");
      await expect(weather).toHaveAttribute("data-weather", "rain");
      const art = weather.locator(".weather-art--large");
      await expect(art).toHaveAttribute("data-art", "rain");
      await expect(art).toHaveAttribute("aria-hidden", "true");
      const box = await art.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(80);
      await expect(weather).toContainText("6 °C / 12 °C");
      await expect(weather).toContainText("70 %");
      await expect(weather).toContainText("22 km/h");
      const hours = weather.locator(".veille-hours__item");
      await expect(hours).toHaveCount(12);
      await expect(hours.first()).toContainText("13 h");
      await expect(hours.last().locator(".weather-art")).toHaveAttribute(
        "data-art",
        "storm",
      );
    });

    test("E-31 : filtres catégorie, langue, source, aimés et recherche", async ({
      page,
      ui,
    }) => {
      await new MockApi(page).install();
      await ui.goto();
      await openVeille(page);
      const panel = dialog(page);
      const chips = panel.getByRole("group", { name: "Catégories" });
      await chips.getByRole("button", { name: /^IA/ }).click();
      await expect(chips.getByRole("button", { name: /^IA/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(count(page)).toHaveText("5 articles sur 20");
      await expect(count(page)).toHaveAttribute("aria-live", "polite");
      await chips.getByRole("button", { name: /^Cloud/ }).click();
      await expect(count(page)).toHaveText("9 articles sur 20");
      await panel.getByRole("button", { name: "Français" }).click();
      await expect(count(page)).toHaveText("2 articles sur 20");
      await chips.getByRole("button", { name: "Toutes" }).click();
      await panel
        .getByRole("button", { name: "Toutes", exact: true })
        .last()
        .click();
      await expect(count(page)).toHaveText("20 articles");
      await panel
        .getByRole("combobox", { name: "Source" })
        .selectOption("Tom's Hardware");
      await expect(articles(page)).toHaveCount(1);
      await panel.getByRole("combobox", { name: "Source" }).selectOption("");
      await panel.getByRole("checkbox", { name: "Aimés seulement" }).check();
      await expect(articles(page)).toHaveCount(1);
      await expect(articles(page).first()).toContainText("AWS Lambda");
      await panel.getByRole("checkbox", { name: "Aimés seulement" }).uncheck();
      // Casse et accents ignorés
      await panel
        .getByLabel("Rechercher dans les articles")
        .fill("CONFORME DES DONNEES");
      await expect(count(page)).toHaveText("1 article sur 20");
      await panel
        .getByLabel("Rechercher dans les articles")
        .fill("introuvable");
      await expect(articles(page)).toHaveCount(0);
      await expect(panel).toContainText("Aucun article ne correspond");
      await panel
        .locator(".veille-empty")
        .getByRole("button", { name: "Effacer les filtres" })
        .click();
      await expect(count(page)).toHaveText("20 articles");
      await expect(
        panel.getByLabel("Rechercher dans les articles"),
      ).toHaveValue("");
    });

    test("E-32 : j'aime, second clic annule, je n'aime pas puis Annuler", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page).install();
      await ui.goto();
      await openVeille(page);
      const item = RUN.items[1];
      const card = articles(page).nth(1);
      const like = card.getByRole("button", { name: `J'aime : ${item.title}` });
      await expect(like).toHaveAttribute("aria-pressed", "false");
      await like.click();
      await expect(like).toHaveAttribute("aria-pressed", "true");
      await like.click();
      await expect(like).toHaveAttribute("aria-pressed", "false");
      await card
        .getByRole("button", { name: `Je n'aime pas : ${item.title}` })
        .click();
      await expect(card).toHaveAttribute("data-vote", "dislike");
      await card.getByRole("button", { name: /^Annuler/ }).click();
      await expect(card).not.toHaveAttribute("data-vote", "dislike");
      await expect.poll(() => veilleWrites(api).length).toBe(4);
      expect(veilleWrites(api).map((w) => [w.path, w.body])).toEqual([
        ["/api/veille/vote", { kind: "article", id: item.id, value: "like" }],
        ["/api/veille/vote", { kind: "article", id: item.id, value: "none" }],
        [
          "/api/veille/vote",
          { kind: "article", id: item.id, value: "dislike" },
        ],
        ["/api/veille/vote", { kind: "article", id: item.id, value: "none" }],
      ]);
      // Article déjà aimé dans le passage : bouton enfoncé dès l'ouverture
      await expect(
        articles(page)
          .first()
          .getByRole("button", { name: `J'aime : ${RUN.items[0].title}` }),
      ).toHaveAttribute("aria-pressed", "true");
    });

    test.describe("vote refusé", () => {
      test.use({ allowConsoleErrors: ["Failed to load resource"] });
      test("E-33 : vote refusé, retour arrière et message court", async ({
        page,
        ui,
      }) => {
        await new MockApi(page)
          .on(/^POST \/api\/veille\/vote$/, (route) =>
            route.fulfill({ status: 404, json: { detail: "Article inconnu" } }),
          )
          .install();
        await ui.goto();
        await openVeille(page);
        const like = articles(page)
          .nth(2)
          .getByRole("button", { name: /^J'aime/ });
        await like.click();
        await expect(page.getByTestId("veille-notice")).toHaveText(
          "Vote non enregistré : Article inconnu",
        );
        await expect(like).toHaveAttribute("aria-pressed", "false");
      });
    });

    test("E-34 : badge « Nouveau » selon l'ouverture précédente", async ({
      page,
      ui,
    }) => {
      await openedAt9(page);
      await new MockApi(page).install();
      await ui.goto();
      await openVeille(page);
      await expect(dialog(page).locator(".veille-tag--new")).toHaveCount(20);
      await closeVeille(page);
      await openVeille(page);
      await expect(dialog(page).locator(".veille-tag--new")).toHaveCount(0);
    });

    test("E-35 : intéressé, prompt préparé, copie en un clic", async ({
      page,
      ui,
      context,
    }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      let release: () => void = () => undefined;
      const ready = new Promise<void>((resolve) => {
        release = resolve;
      });
      const idea = RUN.ideas[2];
      const api = await new MockApi(page)
        .on(/^POST \/api\/veille\/idea\/[0-9a-f]+\/prompt$/, async (route) => {
          await ready;
          return route.fulfill({
            json: { ...PROMPT, idea_id: idea.id, cached: false },
          });
        })
        .install();
      await ui.goto();
      await openVeille(page);
      const card = ideaCard(page, 2);
      await card
        .getByRole("button", { name: `Intéressé : ${idea.title}`, exact: true })
        .click();
      const popup = page.getByRole("dialog", { name: idea.title });
      await expect(popup).toBeVisible();
      await expect(popup).toContainText("Préparation du prompt…");
      await expect(popup.getByTestId("veille-prompt-warning")).toContainText(
        "Relire avant de coller",
      );
      await expect(
        popup.getByRole("button", { name: "Copier" }),
      ).toBeDisabled();
      release();
      const text = popup.getByTestId("veille-prompt-text");
      await expect(text).toContainText("# Contexte");
      await expect(text).toContainText("# Critères de fin");
      await popup.getByRole("button", { name: "Copier" }).click();
      await expect(popup.getByRole("button", { name: "Copié" })).toBeVisible();
      await expect(popup.locator("[aria-live=polite]")).toHaveText(
        "Prompt copié dans le presse-papiers",
      );
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toContain("# Objectif");
      await expect(popup.getByRole("button", { name: "Copier" })).toBeVisible({
        timeout: 4000,
      });
      // Échap ferme seulement la fenêtre du prompt
      await page.keyboard.press("Escape");
      await expect(popup).toHaveCount(0);
      await expect(dialog(page)).toBeVisible();
      await expect(
        card.getByRole("button", {
          name: `Intéressé : ${idea.title}`,
          exact: true,
        }),
      ).toHaveAttribute("aria-pressed", "true");
      // Prompt gardé : « Voir le prompt » le rouvre sans nouvelle requête
      await card
        .getByRole("button", {
          name: `Voir le prompt : ${idea.title}`,
          exact: true,
        })
        .click();
      await expect(popup.getByTestId("veille-prompt-text")).toBeVisible();
      expect(veilleWrites(api).map((w) => [w.method, w.path, w.body])).toEqual([
        [
          "POST",
          "/api/veille/vote",
          { kind: "idea", id: idea.id, value: "like" },
        ],
        ["POST", `/api/veille/idea/${idea.id}/prompt`, null],
      ]);
    });

    test("E-36 : prompt déjà fabriqué, relu sans le refaire", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page).install();
      await ui.goto();
      await openVeille(page);
      await ideaCard(page, 0)
        .getByRole("button", {
          name: `Voir le prompt : ${RUN.ideas[0].title}`,
          exact: true,
        })
        .click();
      await expect(
        promptDialog(page).getByTestId("veille-prompt-text"),
      ).toContainText("# Contexte");
      expect(veilleWrites(api)).toEqual([]);
      expect(
        api.calls
          .filter((c) => c.path.includes("/prompt"))
          .map((c) => c.method),
      ).toEqual(["GET"]);
    });

    test.describe("prompt indisponible", () => {
      test.use({ allowConsoleErrors: ["Failed to load resource"] });
      test("E-37 : modèle injoignable (503), puis Réessayer", async ({
        page,
        ui,
      }) => {
        let fail = true;
        await new MockApi(page)
          .on(/^POST \/api\/veille\/idea\/[0-9a-f]+\/prompt$/, (route) =>
            fail
              ? route.fulfill({
                  status: 503,
                  json: { detail: "aucun modèle utilisable" },
                })
              : route.fulfill({ json: { ...PROMPT, cached: false } }),
          )
          .install();
        await ui.goto();
        await openVeille(page);
        const idea = RUN.ideas[1];
        await ideaCard(page, 1)
          .getByRole("button", {
            name: `Intéressé : ${idea.title}`,
            exact: true,
          })
          .click();
        const popup = page.getByRole("dialog", { name: idea.title });
        await expect(popup.getByRole("alert")).toContainText(
          "Prompt indisponible : aucun modèle utilisable",
        );
        fail = false;
        await popup.getByRole("button", { name: "Réessayer" }).click();
        await expect(popup.getByTestId("veille-prompt-text")).toContainText(
          "# Contexte",
        );
      });
    });

    test("E-38 : pas intéressé, carte repliée puis Annuler", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page).install();
      await ui.goto();
      await openVeille(page);
      const idea = RUN.ideas[3];
      const card = ideaCard(page, 3);
      await card
        .getByRole("button", {
          name: `Pas intéressé : ${idea.title}`,
          exact: true,
        })
        .click();
      await expect(card).toHaveAttribute("data-vote", "dislike");
      await expect(card).not.toContainText(idea.benefit);
      await card.getByRole("button", { name: /^Annuler/ }).click();
      await expect(card).toContainText(idea.benefit);
      expect(veilleWrites(api).map((w) => w.body)).toEqual([
        { kind: "idea", id: idea.id, value: "dislike" },
        { kind: "idea", id: idea.id, value: "none" },
      ]);
      // Idée déjà rejetée dans le passage : repliée dès l'ouverture
      await expect(ideaCard(page, 4)).toHaveAttribute("data-vote", "dislike");
    });

    test("E-39 : passage ancien (schéma 1), pas de bouton de vote", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page).install();
      api.set(
        "veille/latest",
        withRun({
          schema: 1,
          items: RUN.items.slice(0, 3).map((i: Item) => ({
            title: i.title,
            url: i.url,
            source: i.source,
            sentence: i.sentence,
          })) as Item[],
          ideas: RUN.ideas.slice(0, 2).map((i: Run["ideas"][number]) => ({
            title: i.title,
            benefit: i.benefit,
            effort: i.effort,
            first_step: i.first_step,
          })) as Run["ideas"],
        }),
      );
      await ui.goto();
      await openVeille(page);
      await expect(articles(page)).toHaveCount(3);
      await expect(dialog(page).locator(".veille-vote")).toHaveCount(0);
      await expect(
        dialog(page).getByRole("button", { name: /^Intéressé/ }),
      ).toHaveCount(0);
    });

    for (const [width, columns] of [
      [375, 1],
      [768, 2],
      [1440, 3],
    ] as const) {
      test(`E-40 : ${width} px, grille de ${columns} colonne(s) sans défilement horizontal`, async ({
        page,
        ui,
      }) => {
        await page.setViewportSize({ width, height: 800 });
        await new MockApi(page).install();
        await ui.goto();
        const before = await rootScrollWidth(page);
        await openVeille(page);
        await noHorizontalScroll(page, before);
        const tops = await articles(page).evaluateAll((cards) =>
          cards.slice(0, 3).map((card) => card.getBoundingClientRect().top),
        );
        expect(new Set(tops.map(Math.round)).size).toBe(4 - columns);
        // La frise défile dans son propre cadre
        const strip = await page
          .locator(".veille-hours")
          .evaluate((el) => el.clientWidth <= window.innerWidth);
        expect(strip).toBe(true);
      });
    }

    test("E-41 : 375 px, filtres repliés derrière « Filtres »", async ({
      page,
      ui,
    }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await new MockApi(page).install();
      await ui.goto();
      await openVeille(page);
      const toggle = dialog(page).getByRole("button", { name: "Filtres" });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(
        dialog(page).getByRole("group", { name: "Catégories" }),
      ).toBeHidden();
      await toggle.click();
      await expect(
        dialog(page).getByRole("group", { name: "Catégories" }),
      ).toBeVisible();
      const before = await rootScrollWidth(page);
      await noHorizontalScroll(page, before);
    });

    for (const theme of ["light", "dark"] as const) {
      test(`E-42 : thème ${theme === "light" ? "clair" : "sombre"}, couleurs des jetons`, async ({
        page,
        ui,
      }) => {
        await page.addInitScript((t) => {
          localStorage.setItem("antares-theme", t);
        }, theme);
        await new MockApi(page).install();
        await ui.goto();
        await openVeille(page);
        const colors = await page.evaluate(() => {
          const card = document.querySelector<HTMLElement>(
            '.veille-card[data-cat="ia"] .veille-card__cat',
          );
          const root = getComputedStyle(document.documentElement);
          return {
            cat: card ? getComputedStyle(card).color : "",
            token: root.getPropertyValue("--veille-cat-ia").trim(),
            theme: document.documentElement.dataset.theme,
          };
        });
        expect(colors.theme).toBe(theme);
        expect(colors.token).toBe(theme === "light" ? "#6d28d9" : "#c4b5fd");
        expect(colors.cat).toBe(
          theme === "light" ? "rgb(109, 40, 217)" : "rgb(196, 181, 253)",
        );
      });
    }

    test("E-43 : boutons de vote nommés avec le titre, focus visible", async ({
      page,
      ui,
    }) => {
      await new MockApi(page).install();
      await ui.goto();
      await openVeille(page);
      const like = dialog(page).getByRole("button", {
        name: `J'aime : ${RUN.items[3].title}`,
      });
      await like.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(like).toBeFocused();
      const outline = await like.evaluate(
        (el) => getComputedStyle(el).outlineStyle,
      );
      expect(outline).toBe("solid");
    });
  });

  test.describe("sources", () => {
    const sources = (page: Page) =>
      page.getByRole("dialog", { name: "Sources" });
    const openSources = async (page: Page) => {
      await openVeille(page);
      await dialog(page).getByRole("button", { name: "Sources" }).click();
      await expect(sources(page)).toBeVisible();
      await expect(
        sources(page).getByTestId("veille-sources-builtin"),
      ).toBeVisible();
    };

    test("E-50 : liste des sources fournies et ajoutées", async ({
      page,
      ui,
    }) => {
      await new MockApi(page).install();
      await ui.goto();
      await openSources(page);
      const panel = sources(page);
      await expect(panel).toContainText("Mes sources 1/50");
      await expect(panel).toContainText("2 actives sur 3");
      await expect(panel.getByTestId("veille-sources-custom")).toContainText(
        "Sujet : Raspberry Pi",
      );
      const builtin = panel.getByTestId("veille-sources-builtin");
      await expect(builtin.locator("li")).toHaveCount(3);
      await panel.getByRole("searchbox").fill("korben");
      await expect(builtin.locator("li")).toHaveCount(1);
      await expect(builtin.locator("li")).toHaveAttribute(
        "data-enabled",
        "false",
      );
    });

    test("E-51 : tester puis ajouter un site", async ({ page, ui }) => {
      const api = await new MockApi(page).install();
      await ui.goto();
      await openSources(page);
      const panel = sources(page);
      const add = panel.getByRole("button", { name: "Ajouter" });
      await expect(add).toBeDisabled();
      await panel
        .getByLabel("Adresse du site ou du flux RSS")
        .fill("https://blog.exemple.com");
      await panel
        .getByLabel("Catégorie de la nouvelle source")
        .selectOption("ia");
      await panel.getByRole("button", { name: "Tester" }).click();
      const probe = panel.getByTestId("veille-sources-probe");
      await expect(probe).toContainText("blog.exemple.com");
      await expect(probe).toContainText("12 articles, dont 4 de moins de 48 h");
      await expect(probe).toContainText("Premier titre");
      await add.click();
      await expect(panel).toContainText("Mes sources 2/50");
      await expect(panel.getByTestId("veille-sources-custom")).toContainText(
        "blog.exemple.com",
      );
      await expect(
        panel.getByLabel("Adresse du site ou du flux RSS"),
      ).toHaveValue("");
      const written = veilleWrites(api).map((call) => [call.method, call.path]);
      expect(written).toEqual([
        ["POST", "/api/veille/sources/test"],
        ["POST", "/api/veille/sources"],
      ]);
      expect(veilleWrites(api)[1]?.body).toMatchObject({
        kind: "feed",
        url: "https://blog.exemple.com",
        category: "ia",
      });
    });

    test("E-53 : catégorie, suppression en deux clics, interrupteur", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page).install();
      await ui.goto();
      await openSources(page);
      const panel = sources(page);
      await panel
        .getByLabel("Catégorie de Raspberry Pi (Google News)")
        .selectOption("informatique");
      await panel
        .getByRole("button", { name: "Supprimer Raspberry Pi (Google News)" })
        .click();
      await expect(panel).toContainText("Mes sources 1/50");
      await panel
        .getByRole("button", {
          name: "Confirmer la suppression de Raspberry Pi (Google News)",
        })
        .click();
      await expect(panel).toContainText("Aucune source ajoutée.");
      await panel.getByRole("checkbox", { name: /OpenAI/ }).uncheck();
      await expect(panel).toContainText("1 actives sur 3");
      expect(
        veilleWrites(api).map((call) => [call.method, call.path, call.body]),
      ).toEqual([
        ["PATCH", "/api/veille/sources/1", { category: "informatique" }],
        ["DELETE", "/api/veille/sources/1", null],
        [
          "POST",
          "/api/veille/sources/builtin",
          { name: "OpenAI", enabled: false },
        ],
      ]);
    });

    test.describe("erreurs du routeur", () => {
      test.use({ allowConsoleErrors: ["Failed to load resource"] });

      test("E-52 : sujet Google News et source illisible", async ({
        page,
        ui,
      }) => {
        await new MockApi(page).install();
        await ui.goto();
        await openSources(page);
        const panel = sources(page);
        await panel
          .getByLabel("Adresse du site ou du flux RSS")
          .fill("https://panne.exemple.com");
        await panel.getByRole("button", { name: "Tester" }).click();
        await expect(panel.getByRole("alert")).toHaveText(
          "Lecture impossible : 500",
        );
        await panel.getByRole("button", { name: "Sujet" }).click();
        await expect(panel.getByRole("alert")).toHaveCount(0);
        await panel.getByLabel(/^Sujet/).fill("Rust");
        await panel.getByRole("button", { name: "Ajouter" }).click();
        await expect(panel.getByTestId("veille-sources-custom")).toContainText(
          "Rust (Google News)",
        );
      });

      test("E-54 : interrupteur refusé, état rétabli", async ({ page, ui }) => {
        const api = new MockApi(page).on(
          /^POST \/api\/veille\/sources\/builtin$/,
          (route) => route.fulfill({ status: 500, json: { detail: "panne" } }),
        );
        await api.install();
        await ui.goto();
        await openSources(page);
        const toggle = sources(page).getByRole("checkbox", { name: /OpenAI/ });
        await toggle.uncheck();
        await expect(toggle).toBeChecked();
      });
    });

    test("E-55 : mobile 375 px sans défilement horizontal", async ({
      page,
      ui,
    }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await new MockApi(page).install();
      await ui.goto();
      await openSources(page);
      const sizes = await sources(page).evaluate((el) => [
        el.scrollWidth,
        el.clientWidth,
      ]);
      expect(sizes[0]).toBeLessThanOrEqual(sizes[1] ?? 0);
    });
  });

  test.describe("fiche, tous les articles, sources privilégiées, passage manuel", () => {
    const article = (page: Page) =>
      page.getByRole("dialog", { name: RUN.items[2].title });
    const othersTab = (page: Page) =>
      dialog(page).getByRole("tab", { name: /Tous les articles/ });

    test("E-60 : fiche d'un article, extrait et lien vers l'original", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page).install();
      await ui.goto();
      await openVeille(page);
      await dialog(page)
        .getByRole("button", { name: RUN.items[2].title, exact: true })
        .click();
      const panel = article(page);
      await expect(panel).toBeVisible();
      await expect(panel).toContainText("En bref");
      await expect(panel).toContainText(RUN.items[2].sentence);
      await expect(panel).toContainText(RUN.items[2].summary);
      const link = panel.getByRole("link", { name: "Lire l'article original" });
      await expect(link).toHaveAttribute("href", RUN.items[2].url);
      await expect(link).toHaveAttribute("target", "_blank");
      expect(((await link.getAttribute("rel")) ?? "").split(" ")).toEqual(
        expect.arrayContaining(["noopener", "noreferrer"]),
      );
      await panel.getByRole("button", { name: "J'aime", exact: true }).click();
      await expect(
        panel.getByRole("button", { name: "J'aime", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(veilleWrites(api).at(-1)?.body).toEqual({
        kind: "article",
        id: RUN.items[2].id,
        value: "like",
      });
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(dialog(page)).toBeVisible();
      // Vote repris sur la carte
      await expect(
        dialog(page).getByRole("button", {
          name: `J'aime : ${RUN.items[2].title}`,
        }),
      ).toHaveAttribute("aria-pressed", "true");
    });

    test("E-61 : fiche sans extrait", async ({ page, ui }) => {
      await new MockApi(page).install();
      await ui.goto();
      await openVeille(page);
      await dialog(page)
        .getByRole("button", { name: RUN.items[5].title, exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: RUN.items[5].title }),
      ).toContainText("Pas d'extrait fourni par le site");
    });

    test("E-62 : tous les articles, liste compacte, tri, filtre et pages", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page).install();
      await ui.goto();
      await openVeille(page);
      await expect(othersTab(page)).toContainText("56");
      await othersTab(page).click();
      await expect(othersTab(page)).toHaveAttribute("aria-selected", "true");
      const rows = dialog(page).getByTestId("veille-other");
      await expect(rows).toHaveCount(50);
      await expect(rows.first()).toContainText("Article non retenu 1 ");
      await expect(rows.first()).toContainText("Korben");
      await dialog(page)
        .getByRole("button", { name: /Afficher 6 de plus/ })
        .click();
      await expect(rows).toHaveCount(56);
      // Tri par date : le plus récent d'abord
      await dialog(page)
        .getByRole("combobox", { name: "Trier par" })
        .selectOption("date");
      await expect(rows).toHaveCount(50);
      await dialog(page)
        .getByRole("searchbox", { name: "Rechercher dans les articles" })
        .fill("hébergeur");
      await expect(rows).toHaveCount(9);
      await expect(
        dialog(page).getByTestId("veille-others-count"),
      ).toContainText("9 articles sur 56");
      // Vote dans la liste, puis fiche
      const first = rows.first();
      const title = (
        await first.locator(".veille-other__title").innerText()
      ).trim();
      await first.getByRole("button", { name: /^J'aime/ }).click();
      await expect(
        first.getByRole("button", { name: /^J'aime/ }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(veilleWrites(api).at(-1)?.body).toMatchObject({
        kind: "article",
        value: "like",
      });
      await first.locator(".veille-other__open").click();
      const sheet = page.getByRole("dialog", { name: title });
      await expect(sheet).toContainText("Extrait du site");
      await expect(sheet).not.toContainText("En bref");
      await expect(
        sheet.getByRole("button", { name: "J'aime", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
    });

    test("E-63 : source privilégiée depuis la fiche et dans Sources", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page).install();
      await ui.goto();
      await openVeille(page);
      await dialog(page)
        .getByRole("button", { name: RUN.items[2].title, exact: true })
        .click();
      const star = article(page).getByRole("button", {
        name: "Privilégier cette source",
      });
      await star.click();
      await expect(
        article(page).getByRole("button", { name: "Source privilégiée" }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(veilleWrites(api).at(-1)).toMatchObject({
        path: "/api/veille/sources/favorite",
        body: { name: "OpenAI", favorite: true },
      });
      await expect(page.getByTestId("veille-notice")).toContainText(
        "3 places garanties",
      );
      await page.keyboard.press("Escape");
      await dialog(page).getByRole("button", { name: "Sources" }).click();
      const sources = page.getByRole("dialog", { name: "Sources" });
      await expect(
        sources.getByRole("button", { name: "Privilégier OpenAI" }),
      ).toHaveAttribute("aria-pressed", "true");
      await sources.getByRole("button", { name: "Privilégier Korben" }).click();
      await expect(
        sources.getByRole("button", { name: "Privilégier Korben" }),
      ).toHaveAttribute("aria-pressed", "true");
    });

    test("E-64 : nouveau passage, articles ajoutés en tête", async ({
      page,
      ui,
    }) => {
      await openedAt9(page);
      const api = await new MockApi(page).install();
      await ui.goto();
      await openVeille(page);
      const run = dialog(page).getByRole("button", {
        name: "Nouveau passage",
        exact: true,
      });
      await run.click();
      await expect(
        dialog(page).getByRole("button", { name: "En cours…" }),
      ).toBeDisabled();
      expect(
        veilleWrites(api).filter((call) => call.path === "/api/veille/run"),
      ).toHaveLength(1);
      await expect(page.getByTestId("veille-notice")).toContainText(
        "1 article ajouté",
        { timeout: 15_000 },
      );
      const first = dialog(page).getByTestId("veille-article").first();
      await expect(first).toContainText("Article du nouveau passage");
      await expect(first).toContainText("Nouveau");
      await expect(run).toBeEnabled();
    });

    test.describe("passage refusé", () => {
      test.use({ allowConsoleErrors: ["Failed to load resource"] });
      test("E-65 : passage refusé (429), message court", async ({
        page,
        ui,
      }) => {
        await new MockApi(page)
          .on(/^POST \/api\/veille\/run$/, (route) =>
            route.fulfill({
              status: 429,
              json: { detail: "Prochain passage manuel possible dans 4 min" },
            }),
          )
          .install();
        await ui.goto();
        await openVeille(page);
        await dialog(page)
          .getByRole("button", { name: "Nouveau passage", exact: true })
          .click();
        await expect(page.getByTestId("veille-notice")).toHaveText(
          "Passage non lancé : Prochain passage manuel possible dans 4 min",
        );
        await expect(
          dialog(page).getByRole("button", {
            name: "Nouveau passage",
            exact: true,
          }),
        ).toBeEnabled();
      });
    });

    for (const [width, height] of [
      [375, 667],
      [1440, 900],
    ] as const) {
      test(`E-66 : ${width} px, onglets et fiche sans défilement horizontal`, async ({
        page,
        ui,
      }) => {
        await page.setViewportSize({ width, height });
        await new MockApi(page).install();
        await ui.goto();
        const before = await rootScrollWidth(page);
        await openVeille(page);
        await othersTab(page).click();
        await expect(dialog(page).getByTestId("veille-other")).toHaveCount(50);
        await noHorizontalScroll(page, before);
        await dialog(page)
          .getByTestId("veille-other")
          .first()
          .locator("button")
          .first()
          .click();
        const sheet = page.getByTestId("veille-article-dialog");
        await expect(sheet).toBeVisible();
        const sizes = await sheet.evaluate((el) => [
          el.scrollWidth,
          el.clientWidth,
        ]);
        expect(sizes[0]).toBeLessThanOrEqual(sizes[1] ?? 0);
      });
    }
  });

  test.describe("statistiques", () => {
    const stats = (page: Page) =>
      page.getByRole("dialog", { name: "Statistiques" });
    const openStats = async (page: Page) => {
      await openVeille(page);
      await dialog(page).getByRole("button", { name: "Statistiques" }).click();
      await expect(stats(page)).toBeVisible();
    };

    test("E-70 : chiffres clés, goûts, choix de l'IA, évolution, période", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page).install();
      await ui.goto();
      await openStats(page);
      const panel = stats(page);
      await expect(page.getByTestId("veille-kpi-agreement")).toContainText(
        "68,4 %",
      );
      await expect(page.getByTestId("veille-kpi-missed")).toContainText("9");
      await expect(panel).toContainText("Ce que vous aimez lire");
      await expect(panel).toContainText("Ce que choisit l'IA");
      await expect(panel).toContainText("Évolution");
      await expect(panel.locator(".veille-legend").first()).toContainText(
        "45,2 %",
      );
      await expect(panel.locator(".veille-bars").first()).toContainText(
        "Journal du Net",
      );
      await expect(panel.locator(".veille-words li")).toHaveCount(4);
      // Secteur sélectionné au clavier (le survol suit le même chemin) : ligne de lecture
      await panel.locator(".veille-donut path").first().focus();
      await expect(
        panel.locator(".veille-chart__readout").first(),
      ).toContainText("IA : 19 j'aime, 45,2 %");
      // Colonnes : 14 jours, sélection au clavier
      const columns = panel.locator(".veille-chart__plot").first();
      await expect(columns.locator(".veille-chart__column")).toHaveCount(14);
      await columns.locator(".veille-chart__column").first().focus();
      await expect(
        panel.locator(".veille-chart__readout").nth(2),
      ).toContainText("4 nov. : IA 8");
      // Table de chiffres
      await panel.getByText("Voir les chiffres").first().click();
      await expect(panel.locator("table").first()).toContainText("Sécurité");
      // Période
      await panel.getByRole("button", { name: "7 jours" }).click();
      await expect(
        panel.getByRole("button", { name: "7 jours" }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect
        .poll(() =>
          api.calls
            .filter((c) => c.path === "/api/veille/stats")
            .map((c) => c.method),
        )
        .toHaveLength(2);
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(dialog(page)).toBeVisible();
    });

    test("E-71 : période sans données", async ({ page, ui }) => {
      const api = new MockApi(page);
      api.set("veille/stats", {
        days: 30,
        since: "2026-10-19",
        until: "2026-11-17",
        summary: {},
        tastes: {},
        ai: {},
        timeline: [],
      });
      await api.install();
      await ui.goto();
      await openStats(page);
      await expect(page.getByTestId("veille-kpi-agreement")).toContainText(
        "aucun vote",
      );
      await expect(stats(page)).toContainText("Aucun j'aime sur la période.");
      await expect(stats(page)).toContainText("Aucune donnée sur la période.");
    });

    test.describe("statistiques indisponibles", () => {
      test.use({ allowConsoleErrors: ["Failed to load resource"] });
      test("E-72 : erreur du routeur, puis Réessayer", async ({ page, ui }) => {
        let fail = true;
        await new MockApi(page)
          .on(/^GET \/api\/veille\/stats$/, (route) =>
            fail
              ? route.fulfill({ status: 500, json: { detail: "panne" } })
              : route.fulfill({ json: STATS }),
          )
          .install();
        await ui.goto();
        await openStats(page);
        await expect(stats(page).getByRole("alert")).toContainText("panne");
        fail = false;
        await stats(page).getByRole("button", { name: "Réessayer" }).click();
        await expect(page.getByTestId("veille-kpi-agreement")).toContainText(
          "68,4 %",
        );
      });
    });

    for (const [width, height] of [
      [375, 667],
      [1440, 900],
    ] as const) {
      test(`E-73 : ${width} px sans défilement horizontal`, async ({
        page,
        ui,
      }) => {
        await page.setViewportSize({ width, height });
        await new MockApi(page).install();
        await ui.goto();
        await openStats(page);
        await expect(page.getByTestId("veille-kpi-agreement")).toBeVisible();
        const sizes = await stats(page).evaluate((el) => {
          const body = el.querySelector<HTMLElement>(".veille-stats__body");
          return [
            el.scrollWidth,
            el.clientWidth,
            body?.scrollWidth ?? 0,
            body?.clientWidth ?? 0,
          ];
        });
        expect(sizes[0]).toBeLessThanOrEqual(sizes[1] ?? 0);
        expect(sizes[2]).toBeLessThanOrEqual(sizes[3] ?? 0);
      });
    }
  });

  test.describe("traduction", () => {
    test("E-80 : article en anglais traduit en un clic, puis original", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page).install();
      await ui.goto();
      await openVeille(page);
      await dialog(page)
        .getByRole("button", { name: RUN.items[0].title, exact: true })
        .click();
      const sheet = page.getByTestId("veille-article-dialog");
      await expect(sheet.getByRole("heading").first()).toHaveText(
        RUN.items[0].title,
      );
      await sheet.getByRole("button", { name: "Traduire en français" }).click();
      await expect(sheet.getByRole("heading").first()).toHaveText(
        `${RUN.items[0].title} (traduit)`,
      );
      await expect(sheet).toContainText(
        `Extrait traduit : ${RUN.items[0].summary}`,
      );
      await expect(page.getByTestId("veille-translated")).toContainText(
        "ollama/gemma4:e4b",
      );
      expect(
        api.calls
          .filter((c) => c.path.endsWith("/translate"))
          .map((c) => c.method),
      ).toEqual(["POST"]);
      await sheet.getByRole("button", { name: "Voir l'original" }).click();
      await expect(sheet.getByRole("heading").first()).toHaveText(
        RUN.items[0].title,
      );
      await sheet.getByRole("button", { name: "Voir la traduction" }).click();
      await expect(page.getByTestId("veille-translated")).toBeVisible();
      // Seconde ouverture : le routeur rend sa traduction gardée (cached)
      await page.keyboard.press("Escape");
      await dialog(page)
        .getByRole("button", { name: RUN.items[0].title, exact: true })
        .click();
      await sheet.getByRole("button", { name: "Traduire en français" }).click();
      await expect(page.getByTestId("veille-translated")).toBeVisible();
      expect(
        api.calls
          .filter((c) => c.path.endsWith("/translate"))
          .map((c) => c.method),
      ).toEqual(["POST", "POST"]);
    });

    test("E-81 : article en français, pas de bouton", async ({ page, ui }) => {
      await new MockApi(page).install();
      await ui.goto();
      await openVeille(page);
      const french = RUN.items.find((i: Item) => i.lang === "fr");
      await dialog(page)
        .getByRole("button", { name: french.title, exact: true })
        .click();
      await expect(page.getByTestId("veille-article-dialog")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Traduire en français" }),
      ).toHaveCount(0);
    });

    test.describe("traduction impossible", () => {
      test.use({ allowConsoleErrors: ["Failed to load resource"] });
      test("E-82 : modèle injoignable, message court puis nouvel essai", async ({
        page,
        ui,
      }) => {
        let fail = true;
        await new MockApi(page)
          .on(/^POST \/api\/veille\/article\/.+\/translate$/, (route) =>
            fail
              ? route.fulfill({
                  status: 503,
                  json: { detail: "Modèle injoignable : ollama/gemma4:e4b" },
                })
              : route.fulfill({
                  json: {
                    article_id: RUN.items[0].id,
                    title: "Titre traduit",
                    summary: "Extrait traduit",
                    model: "m",
                    created_at: "2026-11-17T14:00:00+00:00",
                    cached: false,
                  },
                }),
          )
          .install();
        await ui.goto();
        await openVeille(page);
        await dialog(page)
          .getByRole("button", { name: RUN.items[0].title, exact: true })
          .click();
        const sheet = page.getByTestId("veille-article-dialog");
        await sheet
          .getByRole("button", { name: "Traduire en français" })
          .click();
        await expect(sheet.getByRole("alert")).toContainText(
          "Traduction impossible : Modèle injoignable",
        );
        fail = false;
        await sheet
          .getByRole("button", { name: "Traduire en français" })
          .click();
        await expect(sheet.getByRole("heading").first()).toHaveText(
          "Titre traduit",
        );
      });
    });
  });
});
