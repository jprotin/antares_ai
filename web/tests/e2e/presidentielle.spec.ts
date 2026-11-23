// Présidentielle 2027, lot 1 en mock (P27-E-01 à P27-E-12) : menu et sous-pages, ordre
// tiré au sort, cartes identiques, statuts, fiche à dix thèmes, votes, sources, texte
// hostile, bandeaux, page Méthode, gardes (hors origine, CSP, erreurs JS).
import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";

import { openPage } from "../support/menu";
import { MockApi } from "../support/mock-api";
import { expect, test } from "../support/test";

const read = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../fixtures/api/${name}.json`, import.meta.url),
      "utf8",
    ),
  );

type Source = { url: string; niveau: string; publie_le: string | null };
type Candidat = {
  id: string;
  nom_affiche: string;
  statut: string;
  parlementaire: boolean;
  description: { texte: string };
  mesures: { theme: string; citation: string; source: Source }[];
};
type Base = {
  jeu: string;
  version: string;
  axes_statut: string;
  themes: { id: string; libelle: string }[];
  candidats: Candidat[];
  journal: { date: string }[];
};

const base = (): Base => read("presidentielle");
const meta = () => read("presidentielle_meta");
const ENTRY = "Présidentielle 2027";
const RNG_KEY = "p27-e2e-rng";

const cards = (page: Page) => page.getByTestId("presidentielle-card");
const detail = (page: Page) => page.getByTestId("presidentielle-detail");
const notice = (page: Page, id: string) =>
  page.locator(`[data-notice="${id}"]`);

// Générateur forcé : crypto.getRandomValues rend la valeur lue dans localStorage
async function forceRng(page: Page) {
  await page.addInitScript((key) => {
    const value = Number(window.localStorage.getItem(key) ?? "0");
    crypto.getRandomValues = <T extends ArrayBufferView | null>(array: T) => {
      if (array instanceof Uint32Array) array.fill(value);
      return array;
    };
  }, RNG_KEY);
}

// Même tirage que shuffle.ts pour un générateur constant
function expectedOrder(ids: string[], value: number): string[] {
  const result = [...ids];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor((value / 2 ** 32) * (i + 1));
    [result[i], result[j]] = [result[j] as string, result[i] as string];
  }
  return result;
}

async function openCandidates(page: Page) {
  await page.goto("./#/presidentielle-2027/candidats");
  await expect(cards(page).first()).toBeVisible();
}

async function openDetail(page: Page, name: string) {
  await page
    .getByRole("button", { name: `Voir la fiche de ${name}`, exact: true })
    .click();
  await expect(detail(page)).toBeVisible();
}

const shownOrder = (page: Page) =>
  cards(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-candidat")),
  );

test.describe("présidentielle 2027 @mock @presidentielle", () => {
  let api: MockApi;

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    api = await new MockApi(page).install();
  });

  test("P27-E-01 : menu et sous-pages Candidats et Méthode", async ({
    page,
  }) => {
    await page.goto("./");
    await openPage(page, ENTRY, "Candidats");
    await expect(page).toHaveURL(/#\/presidentielle-2027\/candidats$/);
    await expect(
      page.getByRole("region", { name: "Candidats", exact: true }),
    ).toBeVisible();
    const menu = page.locator('[data-slot="sidebar"]').first();
    await expect(
      menu.getByRole("link", { name: "Méthode", exact: true }),
    ).toBeVisible();
    for (const absent of ["Assistant", "Quiz"])
      await expect(
        menu.getByRole("link", { name: absent, exact: true }),
      ).toHaveCount(0);
    await openPage(page, ENTRY, "Méthode");
    await expect(page).toHaveURL(/#\/presidentielle-2027\/methode$/);
    await expect(page.getByTestId("presidentielle-methode")).toBeVisible();
  });

  test("P27-E-02 : ordre tiré au sort à chaque visite", async ({ page }) => {
    await forceRng(page);
    const ids = base().candidats.map((c) => c.id);
    const visits: string[][] = [];
    for (const value of [0, 2 ** 31]) {
      await page.goto("./");
      await page.evaluate(([key, v]) => window.localStorage.setItem(key, v), [
        RNG_KEY,
        String(value),
      ] as const);
      await openCandidates(page);
      await page.reload();
      await expect(cards(page).first()).toBeVisible();
      const shown = await shownOrder(page);
      expect(shown).toEqual(expectedOrder(ids, value));
      expect(shown).not.toEqual(ids);
      visits.push(shown as string[]);
      // Même ordre en revenant sur la page pendant la visite
      await openPage(page, ENTRY, "Méthode");
      await openPage(page, ENTRY, "Candidats");
      await expect(cards(page).first()).toBeVisible();
      expect(await shownOrder(page)).toEqual(shown);
    }
    expect(visits[0]).not.toEqual(visits[1]);
  });

  test("P27-E-03 et P27-E-04 : mêmes rubriques, mêmes classes, aucune couleur propre", async ({
    page,
  }) => {
    await openCandidates(page);
    await expect(cards(page)).toHaveCount(base().candidats.length);
    const shapes = await cards(page).evaluateAll((nodes) =>
      nodes.map((node) => ({
        rubriques: [...node.querySelectorAll("[data-rubrique]")].map((r) =>
          r.getAttribute("data-rubrique"),
        ),
        classes: node.className,
        avatar: node.querySelector('[data-slot="avatar"]')?.className,
        fallback: node.querySelector('[data-slot="avatar-fallback"]')
          ?.className,
        colors: getComputedStyle(
          node.querySelector('[data-slot="avatar-fallback"]') as Element,
        ).backgroundColor,
        background: getComputedStyle(node).backgroundColor,
      })),
    );
    const [first, ...others] = shapes;
    expect(first?.rubriques).toEqual([
      "initiales",
      "nom",
      "statut",
      "description",
      "lignes-phares",
      "mise-a-jour",
    ]);
    for (const shape of others) expect(shape).toEqual(first);
    // Candidat sans ligne phare : la rubrique est là, le manque affiché
    const bruno = page.locator('[data-candidat="bruno-demonstra"]');
    await expect(
      bruno.locator('[data-rubrique="lignes-phares"]'),
    ).toContainText("Aucune ligne phare annoncée");
    await expect(page.getByTestId("presidentielle-version")).toContainText(
      base().version,
    );
  });

  test("P27-E-05 : statuts en mots, jamais de pressenti", async ({ page }) => {
    const data = base();
    const carla = data.candidats.find((c) => c.id === "carla-exemplia");
    if (carla) carla.statut = "non_qualifie";
    api.set("presidentielle", data);
    await openCandidates(page);
    await expect(
      page.locator(
        '[data-candidat="gaston-fictorin"] [data-rubrique="statut"]',
      ),
    ).toHaveText("Retiré");
    await expect(
      page.locator('[data-candidat="carla-exemplia"] [data-rubrique="statut"]'),
    ).toHaveText("Non qualifié");
    await expect(
      page.locator('[data-candidat="aline-fictiva"] [data-rubrique="statut"]'),
    ).toHaveText("Déclaré");
    await expect(page.locator("body")).not.toContainText(/pressenti/i);
  });

  test("P27-E-06 : fiche à dix thèmes dans l'ordre de la grille", async ({
    page,
  }) => {
    await openCandidates(page);
    await openDetail(page, "Aline Fictiva");
    const themes = base().themes;
    expect(themes).toHaveLength(10);
    const shown = await detail(page)
      .locator("[data-theme]")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-theme")));
    expect(shown).toEqual(themes.map((t) => t.id));
    // Aline n'a aucune mesure sur le travail
    await expect(detail(page).locator('[data-theme="travail"]')).toContainText(
      "Pas de position connue à ce jour",
    );
    await expect(
      detail(page).locator('[data-theme="economie"] blockquote'),
    ).not.toHaveCount(0);
    await page.getByRole("button", { name: "Retour à la liste" }).click();
    await expect(detail(page)).toHaveCount(0);
    await expect(cards(page)).toHaveCount(base().candidats.length);
  });

  test("P27-E-07 : votes pour le parlementaire seulement", async ({ page }) => {
    await openCandidates(page);
    await openDetail(page, "Aline Fictiva");
    const votes = detail(page).locator('[data-rubrique="votes"]');
    await expect(votes).toBeVisible();
    await expect(votes.locator("[data-vote]")).toHaveCount(2);
    await expect(votes).toContainText("Contre");
    await expect(detail(page)).not.toContainText(/n'a pas voté/i);
    await page.getByRole("button", { name: "Retour à la liste" }).click();
    await openDetail(page, "Bruno Démonstra");
    await expect(detail(page).locator('[data-rubrique="votes"]')).toHaveCount(
      0,
    );
    await expect(detail(page)).not.toContainText(/n'a pas voté/i);
  });

  test("P27-E-08 : liens de source contrôlés sans clic", async ({ page }) => {
    await openCandidates(page);
    await openDetail(page, "Aline Fictiva");
    const aline = base().candidats.find((c) => c.id === "aline-fictiva");
    const mesure = aline?.mesures.find((m) => m.theme === "economie");
    if (!mesure) throw new Error("jeu fictif : mesure d'économie absente");
    const item = detail(page)
      .locator('[data-theme="economie"] [data-mesure]')
      .first();
    await expect(item.locator("blockquote")).toHaveText(mesure.citation);
    await expect(item.locator("[data-nature]").first()).toHaveText(
      "du candidat",
    );
    const source = item.locator("[data-niveau]");
    await expect(source).toHaveAttribute("data-niveau", "candidat");
    await expect(source).toContainText("Document du candidat");
    await expect(source).toContainText("publié le 15 octobre 2026");
    const link = source.getByRole("link");
    await expect(link).toHaveAttribute("href", mesure.source.url);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    // Description : texte de la rédaction ; statut : source officielle
    await expect(detail(page)).toContainText("de la rédaction");
    await expect(
      detail(page).locator('[data-niveau="officiel_etat"]').first(),
    ).toContainText("Officiel État");
    // Votes : niveau « vote réel »
    await expect(
      detail(page).locator('[data-rubrique="votes"] [data-niveau="vote_reel"]'),
    ).toHaveCount(2);
  });

  test("P27-E-09 : texte hostile affiché en texte", async ({ page }) => {
    const hostile = '<img src=x onerror="window.__p27=1">';
    const data = base();
    const aline = data.candidats.find((c) => c.id === "aline-fictiva");
    if (!aline?.mesures[0]) throw new Error("jeu fictif : mesure absente");
    aline.mesures[0].citation = hostile;
    aline.description.texte = `<script>window.__p27=2</script>${hostile}`;
    aline.nom_affiche = "<b>Aline</b> Fictiva";
    api.set("presidentielle", data);
    await openCandidates(page);
    await expect(
      page.locator('[data-candidat="aline-fictiva"] [data-rubrique="nom"]'),
    ).toHaveText("<b>Aline</b> Fictiva");
    await page
      .locator('[data-candidat="aline-fictiva"]')
      .getByRole("button", { name: /Voir la fiche/ })
      .click();
    await expect(detail(page).getByText(hostile).first()).toBeVisible();
    await expect(detail(page).locator("img, script")).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as { __p27?: number }).__p27),
    ).toBeUndefined();
  });

  test("P27-E-10 : bandeaux", async ({ page }) => {
    await openCandidates(page);
    await expect(notice(page, "personnel")).toContainText(
      "Outil personnel, relu par une seule personne",
    );
    await expect(notice(page, "fictif")).toContainText("Données fictives");
    for (const id of ["invite", "cloud", "vide"])
      await expect(notice(page, id)).toHaveCount(0);

    // Invité d'un partage, déploiement cloud
    api.set("presidentielle/meta", {
      ...meta(),
      sharing: true,
      guest: true,
      cible: "cloud",
    });
    await page.reload();
    await expect(notice(page, "invite")).toContainText("ngrok");
    await expect(notice(page, "invite")).toContainText("inspecteur");
    await expect(notice(page, "cloud")).toContainText("Déploiement cloud");
    await expect(notice(page, "personnel")).toBeVisible();

    // Base réelle encore vide
    api.set("presidentielle", { ...base(), jeu: "reel", candidats: [] });
    api.set("presidentielle/meta", { ...meta(), jeu: "reel", fiches: 0 });
    await page.reload();
    await expect(notice(page, "vide")).toContainText(
      "Aucune fiche publiée à ce jour",
    );
    await expect(notice(page, "fictif")).toHaveCount(0);
    await expect(cards(page)).toHaveCount(0);
  });

  test("P27-E-11 : page Méthode", async ({ page }) => {
    await page.goto("./#/presidentielle-2027/methode");
    const methode = page.getByTestId("presidentielle-methode");
    await expect(methode).toContainText(
      "accords ÷ questions répondues où il a une position connue",
    );
    await expect(methode).toContainText("au moins 10 questions");
    const rows = page
      .getByTestId("presidentielle-exemples")
      .locator("tbody tr");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText("A : 60 %, « sur 15 questions »");
    await expect(rows.nth(1)).toContainText(
      "B : « données insuffisantes (6 questions) », pas 100 %",
    );
    await expect(rows.nth(2)).toContainText(
      "Désaccord pour A et C ; B inchangé",
    );
    await expect(rows.nth(3)).toContainText(
      "Question retirée du calcul de tous les candidats",
    );
    // Axes gelés : un par thème
    await expect(methode.locator("[data-axe]")).toHaveCount(10);
    await expect(methode.locator('[data-methode="axes"]')).not.toContainText(
      "en préparation",
    );
    // Journal du plus récent au plus ancien
    const dates = await page
      .getByTestId("presidentielle-journal")
      .locator("li")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-date")));
    expect(dates).toHaveLength(base().journal.length);
    expect(dates).toEqual([...dates].sort().reverse());
    await expect(methode.getByTestId("presidentielle-version")).toContainText(
      base().version,
    );

    // Axes non gelés : « en préparation »
    api.set("presidentielle", { ...base(), axes_statut: "brouillon" });
    await page.reload();
    await expect(page.locator('[data-methode="axes"]')).toContainText(
      "en préparation",
    );
  });

  test("P27-E-12 : gardes existantes, lecture seule", async ({
    page,
    guards,
  }) => {
    await openCandidates(page);
    await openDetail(page, "Aline Fictiva");
    await openPage(page, ENTRY, "Méthode");
    await expect(page.getByTestId("presidentielle-methode")).toBeVisible();
    // Aucune écriture vers la page (DELETE /api/rehearsals/live : démarrage de l'appli)
    expect(
      api.writes().filter((c) => c.path.startsWith("/api/presidentielle")),
    ).toEqual([]);
    const paths = new Set(
      api.calls
        .map((c) => c.path)
        .filter((p) => p.startsWith("/api/presidentielle")),
    );
    expect([...paths].sort()).toEqual([
      "/api/presidentielle",
      "/api/presidentielle/meta",
    ]);
    expect(guards.foreign).toEqual([]);
    expect(await guards.csp()).toEqual([]);
    expect(guards.pageErrors).toEqual([]);
  });

  test("P27-E-13 : au clavier, la fiche prend le focus et le rend au retour", async ({
    page,
  }) => {
    await openCandidates(page);
    const open = page.locator(
      '[data-testid="presidentielle-card"] button[data-open]',
    );
    // Tab jusqu'au premier bouton « Voir la fiche »
    let reached: string | null = null;
    for (let i = 0; i < 80 && !reached; i += 1) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => {
        const active = document.activeElement;
        return active?.matches("button[data-open]")
          ? (active.closest("[data-candidat]")?.getAttribute("data-candidat") ??
              null)
          : null;
      });
    }
    expect(
      reached,
      "bouton « Voir la fiche » atteint au clavier",
    ).not.toBeNull();
    await expect(open.first()).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(detail(page)).toHaveAttribute(
      "data-candidat",
      reached as string,
    );
    const title = detail(page).getByRole("heading", { level: 2 });
    await expect(title).toBeFocused();
    // Le bouton de retour est juste avant le titre
    await page.keyboard.press("Shift+Tab");
    await expect(
      page.getByRole("button", { name: "Retour à la liste" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(detail(page)).toHaveCount(0);
    await expect(
      page.locator(`[data-candidat="${reached}"] button[data-open]`),
    ).toBeFocused();
  });

  test("P27-E-14 : source non https affichée en texte, sans lien", async ({
    page,
  }) => {
    const data = base();
    const aline = data.candidats.find((c) => c.id === "aline-fictiva");
    const mesure = aline?.mesures.find((m) => m.theme === "economie");
    if (!mesure) throw new Error("jeu fictif : mesure d'économie absente");
    mesure.source = { ...mesure.source, url: "javascript:alert(1)" };
    api.set("presidentielle", data);
    await openCandidates(page);
    await openDetail(page, "Aline Fictiva");
    const source = detail(page)
      .locator('[data-theme="economie"] [data-mesure]')
      .first()
      .locator("[data-niveau]");
    await expect(source.locator("[data-sans-lien]")).toBeVisible();
    await expect(source.getByRole("link")).toHaveCount(0);
    await expect(detail(page).locator('a[href^="javascript:"]')).toHaveCount(0);
  });

  test.describe("erreurs de lecture", () => {
    test.use({ allowConsoleErrors: ["Failed to load resource"] });

    test("P27-E-15 : erreur 500, « Lecture impossible » puis « Réessayer »", async ({
      page,
    }) => {
      let fail = true;
      api.on(/^GET \/api\/presidentielle$/, (route) =>
        fail
          ? route.fulfill({ status: 500, json: { detail: "panne simulée" } })
          : route.fulfill({ json: base() }),
      );
      for (const sub of ["candidats", "methode"]) {
        fail = true;
        await page.goto(`./#/presidentielle-2027/${sub}`);
        const alert = page.getByTestId("presidentielle-erreur");
        await expect(alert).toContainText("Lecture impossible");
        await expect(alert).toContainText("panne simulée");
        fail = false;
        await alert.getByRole("button", { name: "Réessayer" }).click();
        await expect(alert).toHaveCount(0);
        if (sub === "candidats")
          await expect(cards(page)).toHaveCount(base().candidats.length);
        else
          await expect(
            page.getByTestId("presidentielle-version"),
          ).toBeVisible();
      }
    });
  });

  test("P27-E-16 : bandeau « Base indisponible »", async ({ page }) => {
    api.set("presidentielle", {
      ...base(),
      disponible: false,
      message: "Dossier de la base introuvable",
      jeu: null,
      candidats: [],
      themes: [],
      journal: [],
    });
    await page.goto("./#/presidentielle-2027/candidats");
    await expect(notice(page, "indisponible")).toContainText(
      "Base indisponible",
    );
    await expect(notice(page, "indisponible")).toContainText(
      "Dossier de la base introuvable",
    );
    await expect(notice(page, "personnel")).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
  });
});
