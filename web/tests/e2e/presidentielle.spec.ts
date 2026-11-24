// Présidentielle 2027 en mock. Lot 1 (P27-E-01 à P27-E-16) : menu et sous-pages, ordre
// tiré au sort, cartes identiques, statuts, fiche à dix thèmes du quiz et deux hors
// quiz, votes, sources, texte
// hostile, bandeaux, page Méthode, gardes (hors origine, CSP, erreurs JS). Lot 2
// (P27-E-20 à P27-E-26) : assistant, citations seules, refus, attente pendant un appel,
// thème des fiches hors quiz.
// Lot 3 (P27-E-30 à P27-E-40) : quiz et rapport, réponses gardées dans le navigateur.
// Lot 4b (P27-E-41 à P27-E-43) : « nouvelle source à relire » au propriétaire seulement,
// positions des votes réels. Lot 5 (P27-E-50 et P27-E-51) : entre-deux-tours (liste
// réduite aux 2 qualifiés) et archive (bandeau « base figée au 2 mai 2027 »).
// Évolution (P27-E-60 à P27-E-63) : frise des versions de la fiche, comparaison des
// versions d'un programme, même gabarit pour tous. Base sans grille (P27-E-64 et
// P27-E-65) : thèmes déduits des mesures, 27 fiches d'identité sans mesure. Mesure
// retirée pour erreur (P27-E-66) : date du retrait seulement, dans toute la frise.
import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";

import { openPage } from "../support/menu";
import { MockApi } from "../support/mock-api";
import { expect, test } from "../support/test";
import { RealtimeMock } from "../support/ws-scenario";

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

  test("P27-E-01 : menu et sous-pages Candidats, Assistant, Quiz et Méthode", async ({
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
    await expect(
      menu.getByRole("link", { name: "Assistant", exact: true }),
    ).toBeVisible();
    await expect(
      menu.getByRole("link", { name: "Quiz", exact: true }),
    ).toBeVisible();
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

  test("P27-E-06 : fiche à dix thèmes dans l'ordre de la grille, puis les deux hors quiz", async ({
    page,
  }) => {
    await openCandidates(page);
    await openDetail(page, "Aline Fictiva");
    const themes = base().themes;
    expect(themes).toHaveLength(12);
    expect(themes.slice(-2).map((t) => t.id)).toEqual([
      "culture",
      "solidarites",
    ]);
    const shown = await detail(page)
      .locator("[data-theme]")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-theme")));
    expect(shown).toEqual(themes.map((t) => t.id));
    // Thèmes hors quiz : sections avec leur libellé et les citations, comme les autres
    const culture = detail(page).locator('[data-theme="culture"]');
    await expect(culture).toContainText("Culture, sport et vie associative");
    await expect(culture.locator("blockquote")).toContainText(
      "Les musées nationaux seront gratuits",
    );
    await expect(
      detail(page).locator('[data-theme="solidarites"] blockquote'),
    ).toContainText("Les aidants familiaux recevront");
    await expect(
      detail(page).locator('[data-theme="solidarites"]'),
    ).toContainText("Famille et solidarités");
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
    // Thèmes des fiches : ceux du quiz, puis les deux hors quiz, signalés
    await expect(methode.locator("[data-theme-methode]")).toHaveCount(12);
    const horsQuiz = methode.locator("[data-hors-quiz]");
    await expect(horsQuiz).toHaveText([
      "Culture, sport et vie associative hors quiz",
      "Famille et solidarités hors quiz",
    ]);
    await expect(methode.locator('[data-methode="themes"]')).toContainText(
      "pas dans le quiz",
    );
    // Axes gelés : un par thème du quiz (aucun pour les thèmes hors quiz)
    await expect(methode.locator("[data-axe]")).toHaveCount(10);
    await expect(
      methode.locator('[data-axe="culture"], [data-axe="solidarites"]'),
    ).toHaveCount(0);
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
      "/api/presidentielle/nouveautes",
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

  // --- Assistant (lot 2) -------------------------------------------------------------

  test.describe("assistant (lot 2)", () => {
    // Réponses 409 (attente) et 503 (modèle refusé) simulées : notées par le navigateur
    test.use({
      allowConsoleErrors: [
        "the server responded with a status of 409",
        "the server responded with a status of 503",
      ],
    });

    type AskPassage = { candidat: string; citation: string; id: string };
    type Ask = {
      introduction: string;
      passages: AskPassage[];
      sans_position: { candidat: string }[];
    };
    const ask = (kind: string): Ask => read(`presidentielle_ask_${kind}`);
    const ASK = /^POST \/api\/presidentielle\/ask$/;
    const answer = (page: Page) => page.getByTestId("presidentielle-reponse");
    const askCalls = () =>
      api.calls.filter((c) => c.path === "/api/presidentielle/ask");
    // Réponse par défaut de l'API simulée : recherche, dans l'ordre envoyé
    const searchAnswer = (body: unknown) => ({
      json: { ...ask("recherche"), ordre: (body as { ordre: string[] }).ordre },
    });

    async function openAssistant(page: Page) {
      await page.goto("./#/presidentielle-2027/assistant");
      await expect(page.getByTestId("presidentielle-assistant")).toBeVisible();
    }

    async function askQuestion(page: Page, question: string) {
      const input = page.getByLabel("Votre question");
      await input.fill(question);
      await input.press("Enter");
    }

    const groupOrder = (page: Page) =>
      answer(page)
        .locator("[data-groupe]")
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getAttribute("data-groupe")),
        );

    test("P27-E-20 : citations seules, groupées dans l'ordre tiré", async ({
      page,
      guards,
    }) => {
      const value = 2 ** 31;
      await page.addInitScript(
        ([key, v]) => window.localStorage.setItem(key, v),
        [RNG_KEY, String(value)] as const,
      );
      await forceRng(page);
      const order = expectedOrder(
        base().candidats.map((c) => c.id),
        value,
      );
      await page.goto("./");
      await openPage(page, ENTRY, "Assistant");
      await expect(page).toHaveURL(/#\/presidentielle-2027\/assistant$/);
      await askQuestion(page, "Que prévoient-ils pour les réacteurs ?");
      await expect(answer(page)).toHaveAttribute("data-kind", "recherche");

      // Corps : question, ordre de la visite et mention d'appel, rien d'autre
      const [call] = askCalls();
      expect(call?.body).toEqual({
        question: "Que prévoient-ils pour les réacteurs ?",
        ordre: order,
        appel_en_cours: false,
      });
      // Groupes dans l'ordre tiré, citations exactes de la base, rien d'autre
      const fixture = ask("recherche");
      const withPassages = new Set(fixture.passages.map((p) => p.candidat));
      expect(await groupOrder(page)).toEqual(
        order.filter((id) => withPassages.has(id)),
      );
      const quotes = answer(page).locator("blockquote");
      await expect(quotes).toHaveCount(fixture.passages.length);
      const byCandidate = order.flatMap((id) =>
        fixture.passages
          .filter((p) => p.candidat === id)
          .map((p) => p.citation),
      );
      await expect(quotes).toHaveText(byCandidate);
      await expect(page.getByTestId("presidentielle-introduction")).toHaveText(
        fixture.introduction,
      );
      await expect(answer(page).locator("[data-nature=candidat]")).toHaveCount(
        fixture.passages.length,
      );
      await expect(answer(page).locator("[data-source]")).toHaveCount(
        fixture.passages.length,
      );
      expect(guards.foreign).toEqual([]);
      expect(await guards.csp()).toEqual([]);
      expect(guards.pageErrors).toEqual([]);
    });

    test("P27-E-21 : refus affiché, aucune citation", async ({ page }) => {
      api.on(ASK, (route) => route.fulfill({ json: ask("refus") }));
      await openAssistant(page);
      await askQuestion(page, "Pour qui voter ?");
      await expect(page.getByTestId("presidentielle-refus")).toContainText(
        "Je ne donne pas de recommandation de vote.",
      );
      await expect(answer(page).locator("blockquote")).toHaveCount(0);

      // Thème : candidats sans position nommés, « Pas de position connue à ce jour »
      api.on(ASK, (route, recorded) =>
        route.fulfill({
          json: {
            ...ask("theme"),
            ordre: (recorded.body as { ordre: string[] }).ordre,
          },
        }),
      );
      await askQuestion(page, "Que proposent-ils sur l'écologie ?");
      await expect(answer(page)).toHaveAttribute("data-kind", "theme");
      await expect(
        answer(page).locator('[data-groupe="carla-exemplia"]'),
      ).toContainText("Pas de position connue à ce jour");
    });

    test("P27-E-26 : thème hors quiz reconnu, libellé de la base affiché", async ({
      page,
    }) => {
      // Réponse du routeur à « Que proposent-ils pour la famille ? » (thème des fiches
      // hors quiz) ; libellé lu dans les thèmes servis par la base
      const fixture = ask("theme");
      const [modele] = fixture.passages;
      api.on(ASK, (route, recorded) =>
        route.fulfill({
          json: {
            ...fixture,
            introduction:
              "Voici les passages relus qui portent sur le thème Famille et solidarités.",
            theme: { id: "solidarites", libelle: "Famille et solidarités" },
            ordre: (recorded.body as { ordre: string[] }).ordre,
            passages: [
              {
                ...modele,
                id: "p27:aline-fictiva:solidarites-aidants",
                theme: "solidarites",
                citation:
                  "Les aidants familiaux recevront un congé rémunéré de trois mois.",
                page: 25,
              },
            ],
            sans_position: [
              {
                candidat: "carla-exemplia",
                nom: "Carla Exemplia",
                texte: "Pas de position connue à ce jour",
              },
              {
                candidat: "bruno-demonstra",
                nom: "Bruno Démonstra",
                texte: "Pas de position connue à ce jour",
              },
            ],
          },
        }),
      );
      await openAssistant(page);
      await askQuestion(page, "Que proposent-ils pour la famille ?");
      await expect(answer(page)).toHaveAttribute("data-kind", "theme");
      await expect(
        answer(page).locator('[data-theme="solidarites"]').first(),
      ).toHaveText("Famille et solidarités");
      await expect(answer(page).locator("blockquote")).toHaveText([
        "Les aidants familiaux recevront un congé rémunéré de trois mois.",
      ]);
      await expect(
        answer(page).locator('[data-groupe="bruno-demonstra"]'),
      ).toContainText("Pas de position connue à ce jour");
    });

    test("P27-E-22 : appel en cours dans ce navigateur", async ({
      page,
      ui,
    }) => {
      const realtime = await new RealtimeMock(page).install();
      api.on(ASK, (route, recorded) =>
        (recorded.body as { appel_en_cours: boolean }).appel_en_cours
          ? route.fulfill({
              status: 409,
              json: { kind: "attente", retry_after: 30 },
            })
          : route.fulfill(searchAnswer(recorded.body)),
      );
      await ui.goto();
      await ui.startCall();
      await realtime.connectedSocket();
      await expect.poll(() => ui.callState()).toBe("listening");
      await openPage(page, ENTRY, "Assistant");
      await askQuestion(page, "Que prévoient-ils pour les réacteurs ?");
      await expect(page.getByTestId("presidentielle-appel")).toContainText(
        "Appel en cours : réponse après l'appel",
      );
      expect(askCalls()[0]?.body).toMatchObject({ appel_en_cours: true });
      await expect(answer(page)).toHaveCount(0);
    });

    test("P27-E-23 : 409 puis réponse servie après 30 s", async ({ page }) => {
      await page.clock.install();
      let waiting = true;
      api.on(ASK, (route, recorded) =>
        waiting
          ? route.fulfill({
              status: 409,
              json: { kind: "attente", retry_after: 30 },
            })
          : route.fulfill(searchAnswer(recorded.body)),
      );
      await openAssistant(page);
      await askQuestion(page, "Que prévoient-ils pour les réacteurs ?");
      await expect(page.getByTestId("presidentielle-appel")).toBeVisible();
      expect(askCalls()).toHaveLength(1);
      await page.clock.runFor(29_000);
      expect(askCalls()).toHaveLength(1);
      waiting = false;
      await page.clock.runFor(1_000);
      await expect(answer(page)).toHaveAttribute("data-kind", "recherche");
      await expect(page.getByTestId("presidentielle-appel")).toHaveCount(0);
      expect(askCalls()).toHaveLength(2);
      expect(askCalls()[1]?.body).toEqual(askCalls()[0]?.body);
      // Réponse servie : plus aucun renvoi
      await page.clock.runFor(120_000);
      expect(askCalls()).toHaveLength(2);
    });

    test("P27-E-24 : bandeau invité au-dessus de l'assistant", async ({
      page,
    }) => {
      api.set("presidentielle/meta", { ...meta(), sharing: true, guest: true });
      await openAssistant(page);
      const banner = notice(page, "invite");
      await expect(banner).toContainText("ngrok");
      await expect(banner).toContainText("inspecteur");
      const bannerBox = await banner.boundingBox();
      const formBox = await page
        .getByTestId("presidentielle-assistant")
        .boundingBox();
      expect(bannerBox && formBox && bannerBox.y < formBox.y).toBe(true);
      await expect(page.getByTestId("presidentielle-assistant")).toContainText(
        "Vos questions ne sont pas conservées",
      );
    });

    test("P27-E-25 : quitter la page annule l'attente ; erreur du routeur affichée", async ({
      page,
    }) => {
      await page.clock.install();
      api.on(ASK, (route) =>
        route.fulfill({
          status: 409,
          json: { kind: "attente", retry_after: 30 },
        }),
      );
      await openAssistant(page);
      await askQuestion(page, "Que prévoient-ils pour les réacteurs ?");
      await expect(page.getByTestId("presidentielle-appel")).toBeVisible();
      await openPage(page, ENTRY, "Méthode");
      await page.clock.runFor(120_000);
      expect(askCalls()).toHaveLength(1);

      api.on(ASK, (route) =>
        route.fulfill({
          status: 503,
          json: { detail: "modèle non autorisé pour cette page" },
        }),
      );
      await openPage(page, ENTRY, "Assistant");
      await askQuestion(page, "Que prévoient-ils pour les réacteurs ?");
      await expect(page.getByRole("alert")).toContainText(
        "modèle non autorisé pour cette page",
      );
    });
  });

  test.describe("quiz (lot 3)", () => {
    type QuizOption = { id: string; libelle: string; speciale: boolean };
    type QuizQuestion = {
      id: string;
      eligible: boolean;
      options: QuizOption[];
    };
    type Quiz = {
      version: string;
      grille_version: string;
      themes: { id: string; questions: QuizQuestion[] }[];
      rattachements: unknown[];
    };
    const QUIZ_KEY = "antares.presidentielle.quiz";
    const ALINE = "aline-fictiva";
    const BRUNO = "bruno-demonstra";
    const CARLA = "carla-exemplia";
    // Une mesure existante de chaque fiche (citation et source dans le détail)
    const MESURE: Record<string, string> = {
      [ALINE]: "eco-impot",
      [BRUNO]: "eco-impot",
      [CARLA]: "eco-bareme",
    };

    // Grille de démonstration, les 20 questions rendues éligibles ; positions écrites
    // pour rejouer les exemples de la spec (Aline : 9 accords sur 15 ; Bruno : 6 accords
    // sur 6 ; Carla : 11 sur 12)
    const quizBase = (): Quiz => read("presidentielle_quiz");
    const questionsOf = (quiz: Quiz) => quiz.themes.flatMap((t) => t.questions);
    const ordinary = (q: QuizQuestion) => q.options.filter((o) => !o.speciale);

    function scenario() {
      const quiz = quizBase();
      for (const q of questionsOf(quiz)) q.eligible = true;
      const qs = questionsOf(quiz);
      const opt = (i: number, k: number) =>
        (ordinary(qs[i] as QuizQuestion)[k] as QuizOption).id;
      const id = (i: number) => (qs[i] as QuizQuestion).id;
      const link = (i: number, candidat: string, k: number) => ({
        question: id(i),
        candidat,
        option: opt(i, k),
        mesure_id: MESURE[candidat] as string,
      });
      quiz.rattachements = [
        ...[...Array(15).keys(), 16, 17, 18].map((i) => link(i, ALINE, 0)),
        ...[...Array(6).keys()].map((i) => link(i, BRUNO, 0)),
        ...[...Array(11).keys()].map((i) => link(i, CARLA, i < 9 ? 0 : 1)),
        link(11, CARLA, 2),
      ];
      // Réponses : 0 à 8 accord avec Aline ; 9 à 13 et 15 autre option ; 14 « aucune » ;
      // 16 et 17 « sans avis » ; 18 et 19 sans réponse
      const answers = new Map<string, string | null>();
      qs.forEach((_, i) => {
        let value: string | null;
        if (i < 9) value = opt(i, 0);
        else if (i === 14) value = "aucune";
        else if (i < 16) value = opt(i, 1);
        else if (i < 18) value = "sans-avis";
        else value = null;
        answers.set(id(i), value);
      });
      return { quiz, answers };
    }

    const card = (page: Page) => page.getByTestId("presidentielle-quiz");
    const report = (page: Page) => page.getByTestId("presidentielle-rapport");
    const rows = (page: Page) => page.getByTestId("presidentielle-proximite");
    const rowOrder = (page: Page) =>
      rows(page).evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("data-candidat")),
      );
    const stored = (page: Page) =>
      page.evaluate((key) => window.localStorage.getItem(key), QUIZ_KEY);

    async function openQuiz(page: Page) {
      await page.goto("./#/presidentielle-2027/quiz");
      await expect(card(page)).toBeVisible();
    }

    const currentQuestion = async (page: Page) =>
      (await card(page).getAttribute("data-question")) as string;

    async function choose(page: Page, option: string) {
      await card(page)
        .locator(`[data-option="${option}"] [role="radio"]`)
        .click();
    }

    // Répond à toutes les questions, dans l'ordre présenté, d'après la table des réponses
    async function answerAll(page: Page, answers: Map<string, string | null>) {
      const seen: string[] = [];
      for (let i = 0; i < answers.size; i += 1) {
        await expect(card(page).locator("[data-position]")).toHaveText(
          `Question ${i + 1} sur ${answers.size}`,
        );
        const id = await currentQuestion(page);
        seen.push(id);
        const value = answers.get(id);
        if (value) await choose(page, value);
        const last = i === answers.size - 1;
        await card(page)
          .getByRole("button", { name: last ? "Voir le rapport" : "Suivant" })
          .click();
      }
      await expect(report(page)).toBeVisible();
      return seen;
    }

    async function forceValue(page: Page, value: number) {
      await forceRng(page);
      await page.goto("./");
      await page.evaluate(([key, v]) => window.localStorage.setItem(key, v), [
        RNG_KEY,
        String(value),
      ] as const);
      // Nouvelle visite : l'ordre des candidats est tiré avec la valeur forcée
      await page.reload();
    }

    // Ordre de la visite (tirage constant) restreint aux participants du quiz
    const drawnParticipants = (value: number) =>
      expectedOrder(
        base().candidats.map((c) => c.id),
        value,
      ).filter((id) => [ALINE, BRUNO, CARLA].includes(id));

    test("P27-E-30 et P27-E-31 : aucune réponse envoyée, aucune fuite détournée", async ({
      page,
      guards,
    }) => {
      // Instrumentation de toutes les sorties du navigateur
      await page.addInitScript(() => {
        const sent: { kind: string; url: string; body: string }[] = [];
        (window as unknown as { __sent: typeof sent }).__sent = sent;
        const text = (body: unknown) =>
          typeof body === "string" ? body : body ? String(body) : "";
        const fetch0 = window.fetch.bind(window);
        window.fetch = (input, init) => {
          sent.push({
            kind: "fetch",
            url: String(input instanceof Request ? input.url : input),
            body: text(init?.body),
          });
          return fetch0(input, init);
        };
        const beacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = (url, data) => {
          sent.push({ kind: "beacon", url: String(url), body: text(data) });
          return beacon(url, data);
        };
        const send0 = WebSocket.prototype.send;
        WebSocket.prototype.send = function (data) {
          sent.push({ kind: "ws", url: this.url, body: text(data) });
          return send0.call(this, data);
        };
        const xhr0 = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function (body) {
          sent.push({ kind: "xhr", url: "", body: text(body) });
          return xhr0.call(this, body);
        };
      });
      const { quiz, answers } = scenario();
      api.set("presidentielle/quiz", quiz);
      await openQuiz(page);
      const start = api.calls.length;
      await answerAll(page, answers);
      await page.getByRole("button", { name: "Trier par proximité" }).click();
      await report(page).getByRole("button", { name: "Effacer" }).click();
      await expect(card(page)).toBeVisible();

      const after = api.calls.slice(start);
      expect(after.filter((c) => c.method !== "GET")).toEqual([]);
      expect(
        after.filter((c) => c.path.startsWith("/api/presidentielle")),
      ).toEqual([]);
      // Avant le quiz : seules la base, la méta, les nouveautés du propriétaire et la
      // grille sont lues
      const before = new Set(
        api.calls
          .slice(0, start)
          .map((c) => c.path)
          .filter((p) => p.startsWith("/api/presidentielle")),
      );
      expect([...before].sort()).toEqual([
        "/api/presidentielle",
        "/api/presidentielle/meta",
        "/api/presidentielle/nouveautes",
        "/api/presidentielle/quiz",
      ]);
      expect(
        api.writes().filter((c) => c.path.startsWith("/api/presidentielle")),
      ).toEqual([]);

      const sent = await page.evaluate(
        () =>
          (
            window as unknown as {
              __sent: { kind: string; url: string; body: string }[];
            }
          ).__sent,
      );
      const options = [...answers.values()].filter(
        (v): v is string => v !== null && v !== "aucune" && v !== "sans-avis",
      );
      for (const item of sent) {
        expect(item.kind).not.toBe("beacon");
        for (const option of options) {
          expect(item.url).not.toContain(option);
          expect(item.body).not.toContain(option);
        }
        expect(item.body).not.toContain("reponses");
      }
      expect(guards.foreign).toEqual([]);
      expect(await guards.csp()).toEqual([]);
      expect(guards.pageErrors).toEqual([]);
    });

    test("P27-E-32 : réponses dans le navigateur seulement", async ({
      page,
    }) => {
      const { quiz, answers } = scenario();
      api.set("presidentielle/quiz", quiz);
      await openQuiz(page);
      await answerAll(page, answers);
      const saved = JSON.parse((await stored(page)) as string);
      expect(saved.base_version).toBe(quiz.version);
      expect(saved.grille_version).toBe(quiz.grille_version);
      expect(Object.keys(saved.reponses)).toHaveLength(18);
      expect(saved.termine_le).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(saved.ordre_questions).toHaveLength(20);
      const elsewhere = await page.evaluate(() => ({
        session: JSON.stringify({ ...window.sessionStorage }),
        cookies: document.cookie,
      }));
      for (const id of answers.keys()) {
        expect(elsewhere.session).not.toContain(id);
        expect(elsewhere.cookies).not.toContain(id);
      }
      // Réouverture : même ordre, rapport repris
      await page.reload();
      await expect(report(page)).toBeVisible();
      await page.getByRole("button", { name: "Modifier mes réponses" }).click();
      expect(await currentQuestion(page)).toBe(saved.ordre_questions[0]);
    });

    test("P27-E-33 : retour en arrière, réponse précédente modifiable ; options spéciales en dernier", async ({
      page,
    }) => {
      const { quiz } = scenario();
      api.set("presidentielle/quiz", quiz);
      await openQuiz(page);
      const first = await currentQuestion(page);
      const question = questionsOf(quiz).find((q) => q.id === first);
      const [a, b] = ordinary(question as QuizQuestion).map((o) => o.id);
      // « Aucune » puis « sans avis » en dernier
      const shown = await card(page)
        .locator("[data-option]")
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getAttribute("data-option")),
        );
      expect(shown.slice(-2)).toEqual(["aucune", "sans-avis"]);
      await expect(
        card(page).getByRole("button", { name: "Précédent" }),
      ).toBeDisabled();

      await choose(page, a as string);
      await card(page).getByRole("button", { name: "Suivant" }).click();
      await expect(card(page)).not.toHaveAttribute("data-question", first);
      await card(page).getByRole("button", { name: "Précédent" }).click();
      await expect(card(page)).toHaveAttribute("data-question", first);
      const radio = (option: string) =>
        card(page).locator(`[data-option="${option}"] [role="radio"]`);
      await expect(radio(a as string)).toHaveAttribute("aria-checked", "true");
      await choose(page, b as string);
      await expect(radio(b as string)).toHaveAttribute("aria-checked", "true");
      await expect(radio(a as string)).toHaveAttribute("aria-checked", "false");
      const saved = JSON.parse((await stored(page)) as string);
      expect(saved.reponses[first]).toBe(b);

      // Au clavier : flèches dans le groupe, Entrée sur « Suivant »
      // Radix déplace le focus au tour suivant et ne coche l'option que si la flèche
      // est encore enfoncée : touche relâchée seulement après le déplacement
      await radio(b as string).focus();
      await page.keyboard.down("ArrowDown");
      await expect(radio(b as string)).not.toBeFocused();
      await page.keyboard.up("ArrowDown");
      await expect(
        card(page).locator('[role="radio"][aria-checked="true"]'),
      ).toHaveCount(1);
      await expect(radio(b as string)).toHaveAttribute("aria-checked", "false");
      await card(page).getByRole("button", { name: "Suivant" }).focus();
      await page.keyboard.press("Enter");
      await expect(card(page)).not.toHaveAttribute("data-question", first);
      // Le focus suit la question : son énoncé
      await expect(card(page).locator("h3")).toBeFocused();
    });

    test("P27-E-34, P27-E-35 et P27-E-36 : exemples 1 et 2, ordre tiré, tri à la demande", async ({
      page,
    }) => {
      const value = 2 ** 31;
      await forceValue(page, value);
      const { quiz, answers } = scenario();
      api.set("presidentielle/quiz", quiz);
      await openQuiz(page);
      await answerAll(page, answers);
      const drawn = drawnParticipants(value);
      expect(await rowOrder(page)).toEqual(drawn);
      const row = (id: string) =>
        rows(page).and(page.locator(`[data-candidat="${id}"]`));
      await expect(row(ALINE).locator("[data-score]")).toHaveText(
        "60 %, sur 15 questions",
      );
      await expect(row(ALINE).getByRole("progressbar")).toHaveAttribute(
        "aria-label",
        "Aline Fictiva : 60 %, sur 15 questions",
      );
      await expect(row(BRUNO).locator("[data-score]")).toHaveText(
        "données insuffisantes (6 questions)",
      );
      await expect(row(BRUNO).getByRole("progressbar")).toHaveCount(0);
      await expect(row(BRUNO)).not.toContainText("100 %");
      await expect(row(CARLA).locator("[data-score]")).toHaveText(
        "92 %, sur 12 questions",
      );
      // Candidat retiré absent
      await expect(rows(page)).toHaveCount(3);

      // Tri seulement à la demande ; retour à l'ordre tiré
      const sort = page.getByRole("button", { name: "Trier par proximité" });
      await expect(sort).toHaveAttribute("aria-pressed", "false");
      await sort.click();
      await expect(sort).toHaveAttribute("aria-pressed", "true");
      expect(await rowOrder(page)).toEqual([CARLA, ALINE, BRUNO]);
      await sort.click();
      await expect(sort).toHaveAttribute("aria-pressed", "false");
      expect(await rowOrder(page)).toEqual(drawn);

      // Barres à deux pôles : décompte écrit par thème ; détail avec mesure et source
      const poles = page.getByTestId("presidentielle-pole");
      await expect(poles).toHaveCount(10);
      for (const text of await poles
        .locator("[data-decompte]")
        .allTextContents())
        expect(text).toMatch(/^\d+ vers .+, \d+ vers .+, \d+ mixte$/);
      const detail = page.getByTestId("presidentielle-detail-quiz");
      await expect(detail.locator("[data-question]")).toHaveCount(20);
      await expect(
        detail.locator(".presidentielle-citation").first(),
      ).toBeVisible();
      await expect(detail.locator("[data-source]").first()).toBeVisible();
    });

    test("P27-E-37 : vocabulaire interdit absent", async ({ page }) => {
      const { quiz, answers } = scenario();
      api.set("presidentielle/quiz", quiz);
      await openQuiz(page);
      const words = /recommandé|votre candidat|gagnant/i;
      expect(await page.locator("main").innerText()).not.toMatch(words);
      await answerAll(page, answers);
      expect(await page.locator("main").innerText()).not.toMatch(words);
    });

    test("P27-E-38 : invité d'un partage, même parcours, aucune écriture", async ({
      page,
    }) => {
      api.set("presidentielle/meta", { ...meta(), sharing: true, guest: true });
      const { quiz, answers } = scenario();
      api.set("presidentielle/quiz", quiz);
      await openQuiz(page);
      await expect(notice(page, "invite")).toBeVisible();
      const start = api.calls.length;
      await answerAll(page, answers);
      await expect(rows(page)).toHaveCount(3);
      expect(api.calls.slice(start)).toEqual([]);
      expect(
        api.writes().filter((c) => c.path.startsWith("/api/presidentielle")),
      ).toEqual([]);
    });

    test("P27-E-39 : « Effacer » supprime la clé et rend un quiz vierge", async ({
      page,
    }) => {
      const { quiz, answers } = scenario();
      api.set("presidentielle/quiz", quiz);
      await openQuiz(page);
      await answerAll(page, answers);
      expect(await stored(page)).not.toBeNull();
      await report(page).getByRole("button", { name: "Effacer" }).click();
      await expect(card(page).locator("[data-position]")).toHaveText(
        "Question 1 sur 20",
      );
      expect(await stored(page)).toBeNull();
      await expect(
        card(page).locator('[role="radio"][aria-checked="true"]'),
      ).toHaveCount(0);
      await page.reload();
      await expect(card(page).locator("[data-position]")).toHaveText(
        "Question 1 sur 20",
      );
      await expect(report(page)).toHaveCount(0);
      expect(await stored(page)).toBeNull();
    });

    test("« Revenir au rapport » et « Effacer » depuis les questions", async ({
      page,
    }) => {
      const { quiz, answers } = scenario();
      api.set("presidentielle/quiz", quiz);
      await openQuiz(page);
      await answerAll(page, answers);
      // Arrivée au rapport : le focus va à son titre
      await expect(
        report(page).getByRole("heading", { name: "Rapport du quiz" }),
      ).toBeFocused();
      await page.getByRole("button", { name: "Modifier mes réponses" }).click();
      await expect(card(page)).toBeVisible();
      await page.getByRole("button", { name: "Revenir au rapport" }).click();
      await expect(report(page)).toBeVisible();
      await page.getByRole("button", { name: "Modifier mes réponses" }).click();
      await page.getByRole("button", { name: "Effacer", exact: true }).click();
      expect(await stored(page)).toBeNull();
      await expect(card(page).locator("[data-position]")).toHaveText(
        "Question 1 sur 20",
      );
      await expect(
        page.getByRole("button", { name: "Revenir au rapport" }),
      ).toHaveCount(0);
    });

    test("P27-E-40 : animations réduites ; chaque barre a un aria-label et un texte", async ({
      page,
    }) => {
      const { quiz, answers } = scenario();
      api.set("presidentielle/quiz", quiz);
      await openQuiz(page);
      const animation = await page
        .getByTestId("presidentielle-question")
        .evaluate((node) => getComputedStyle(node).animationName);
      expect(animation).toBe("none");
      await answerAll(page, answers);
      const bars = report(page).getByRole("progressbar");
      // 2 barres de proximité (Bruno insuffisant) et 8 barres à deux pôles : les deux
      // derniers thèmes n'ont que « sans avis » ou aucune réponse (pas de barre)
      await expect(bars).toHaveCount(10);
      await expect(
        page
          .getByTestId("presidentielle-pole")
          .getByText("aucune réponse placée"),
      ).toHaveCount(2);
      // Thèmes des fiches hors quiz : ni question, ni barre dans le rapport
      await expect(page.getByTestId("presidentielle-pole")).toHaveCount(10);
      await expect(
        report(page).locator(
          '[data-theme="culture"], [data-theme="solidarites"]',
        ),
      ).toHaveCount(0);
      for (const label of await bars.evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("aria-label")),
      ))
        expect(label).toMatch(/ : .+/);
      for (const item of await page.getByTestId("presidentielle-pole").all())
        await expect(item.locator("[data-decompte]")).not.toBeEmpty();
    });

    test("axes non gelés : barres masquées ; base modifiée : recalcul proposé ; grille modifiée : réponses écartées", async ({
      page,
    }) => {
      const { quiz, answers } = scenario();
      api.set("presidentielle/quiz", {
        ...quiz,
        axes_statut: "validee",
        barres_visibles: false,
      });
      await openQuiz(page);
      await answerAll(page, answers);
      await expect(page.locator('[data-poles="masquees"]')).toBeVisible();
      await expect(page.getByTestId("presidentielle-pole")).toHaveCount(0);

      // Base modifiée depuis le quiz : réponses gardées, recalcul à la demande
      api.set("presidentielle/quiz", { ...quiz, version: "autre-version" });
      await page.reload();
      await expect(notice(page, "base")).toContainText(
        "Base modifiée depuis votre quiz, recalculer",
      );
      await expect(report(page)).toHaveCount(0);
      await page.getByRole("button", { name: "Recalculer" }).click();
      await expect(report(page)).toBeVisible();
      await expect(notice(page, "base")).toHaveCount(0);
      const saved = JSON.parse((await stored(page)) as string);
      expect(saved.base_version).toBe("autre-version");
      expect(Object.keys(saved.reponses)).toHaveLength(18);

      // Grille modifiée : réponses écartées, avec un message
      api.set("presidentielle/quiz", {
        ...quiz,
        version: "autre-version",
        grille_version: "autre-grille",
      });
      await page.reload();
      await expect(notice(page, "grille")).toBeVisible();
      await expect(card(page).locator("[data-position]")).toHaveText(
        "Question 1 sur 20",
      );
      expect(JSON.parse((await stored(page)) as string).reponses).toEqual({});
    });

    test("stockage indisponible : quiz en mémoire, sans plantage", async ({
      page,
      guards,
    }) => {
      await page.addInitScript(() => {
        const throwing = () => {
          throw new DOMException("refusé", "SecurityError");
        };
        Storage.prototype.getItem = throwing;
        Storage.prototype.setItem = throwing;
        Storage.prototype.removeItem = throwing;
      });
      const { quiz } = scenario();
      api.set("presidentielle/quiz", quiz);
      await openQuiz(page);
      const id = await currentQuestion(page);
      const question = questionsOf(quiz).find((q) => q.id === id);
      await choose(page, ordinary(question as QuizQuestion)[0]?.id as string);
      await expect(notice(page, "stockage")).toBeVisible();
      await card(page).getByRole("button", { name: "Suivant" }).click();
      await card(page).getByRole("button", { name: "Précédent" }).click();
      await expect(
        card(page).locator('[role="radio"][aria-checked="true"]'),
      ).toHaveCount(1);
      expect(guards.pageErrors).toEqual([]);
    });

    test("quiz indisponible : aucune question éligible", async ({ page }) => {
      await page.goto("./#/presidentielle-2027/quiz");
      // Jeu de démonstration : 3 questions éligibles seulement
      await expect(card(page).locator("[data-position]")).toHaveText(
        "Question 1 sur 3",
      );
      const quiz = quizBase();
      for (const q of questionsOf(quiz)) q.eligible = false;
      api.set("presidentielle/quiz", quiz);
      await page.reload();
      await expect(notice(page, "quiz-indisponible")).toBeVisible();
      await expect(card(page)).toHaveCount(0);
    });
  });

  test.describe("surveillance et votes réels (lot 4b)", () => {
    const nouveautesCalls = () =>
      api.calls.filter((c) => c.path === "/api/presidentielle/nouveautes");

    test("P27-E-41 : « nouvelle source à relire » pour le propriétaire", async ({
      page,
    }) => {
      api.set("presidentielle/nouveautes", read("presidentielle_nouveautes"));
      await openCandidates(page);
      const banner = notice(page, "nouveautes");
      await expect(banner).toContainText("Nouvelle source à relire");
      await expect(banner).toContainText("Rien n'est publié");
      const item = banner.locator('[data-nouveaute="aline-fictiva"]');
      await expect(item).toContainText("Aline Fictiva");
      await expect(item).toContainText("21 novembre 2026");
      const link = item.getByRole("link");
      await expect(link).toHaveAttribute(
        "href",
        "https://aline.exemple.invalid/programme",
      );
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      // Même bandeau sur les autres sous-pages ; aucune écriture
      await openPage(page, ENTRY, "Méthode");
      await expect(notice(page, "nouveautes")).toBeVisible();
      expect(
        api.writes().filter((c) => c.path.startsWith("/api/presidentielle")),
      ).toEqual([]);
      // Aucun signalement : aucun bandeau
      api.set("presidentielle/nouveautes", {
        signalements: [],
        pages_suivies: 3,
        en_erreur: 0,
        derniere_visite: null,
      });
      await openPage(page, ENTRY, "Candidats");
      await expect(notice(page, "personnel")).toBeVisible();
      await expect(notice(page, "nouveautes")).toHaveCount(0);
    });

    test.describe("refus du routeur", () => {
      // Le navigateur journalise la réponse 403 de la route refusée
      test.use({ allowConsoleErrors: ["status of 403"] });

      test("P27-E-42 : invité ou refus du routeur, rien d'affiché", async ({
        page,
      }) => {
        api.set("presidentielle/nouveautes", read("presidentielle_nouveautes"));
        api.set("presidentielle/meta", {
          ...meta(),
          sharing: true,
          guest: true,
        });
        await openCandidates(page);
        await expect(notice(page, "invite")).toBeVisible();
        await expect(notice(page, "nouveautes")).toHaveCount(0);
        expect(nouveautesCalls()).toEqual([]);
        await expect(page.locator("main")).not.toContainText(
          "aline.exemple.invalid",
        );

        // Propriétaire supposé, mais le routeur refuse (origine étrangère, tunnel) :
        // aucun bandeau, la page reste servie
        api.set("presidentielle/meta", meta());
        api.on(/^GET \/api\/presidentielle\/nouveautes$/, (route) =>
          route.fulfill({
            status: 403,
            json: { detail: "réservé au propriétaire et à l'accès local" },
          }),
        );
        await page.reload();
        await expect(cards(page).first()).toBeVisible();
        await expect.poll(() => nouveautesCalls().length).toBeGreaterThan(0);
        await expect(notice(page, "nouveautes")).toHaveCount(0);
        await expect(page.getByText("Lecture impossible")).toHaveCount(0);
      });
    });

    test("P27-E-43 : positions des votes réels en mots, absences comprises", async ({
      page,
    }) => {
      const data = base();
      const aline = data.candidats.find((c) => c.id === "aline-fictiva") as
        { votes: { position: string }[] } | undefined;
      const [first, second] = aline?.votes ?? [];
      if (!first || !second) throw new Error("votes d'Aline Fictiva absents");
      first.position = "sans_vote";
      second.position = "non_votant";
      api.set("presidentielle", data);
      await openCandidates(page);
      await openDetail(page, "Aline Fictiva");
      const votes = detail(page).locator('[data-rubrique="votes"]');
      await expect(votes.locator("[data-vote]")).toHaveCount(2);
      await expect(votes).toContainText("Aucun vote enregistré");
      await expect(votes).toContainText("Non-votant");
      await expect(votes).toContainText("n'entrent pas dans le calcul du quiz");
      await expect(detail(page)).not.toContainText(/n'a pas voté/i);
    });
  });

  test.describe("entre-deux-tours et archive (lot 5)", () => {
    // Variantes du jeu fictif tirées du routeur : Aline et Bruno qualifiés, une mesure
    // d'Aline ajoutée après le premier tour
    const QUALIFIES = ["aline-fictiva", "bruno-demonstra"];

    function usePhase(name: "entre_tours" | "archive") {
      const variant = read(`presidentielle_${name}`) as Record<string, unknown>;
      for (const key of [
        "presidentielle",
        "presidentielle/meta",
        "presidentielle/quiz",
      ]) {
        api.set(key, variant[key]);
      }
    }

    async function quizAndAssistantOpen(page: Page) {
      await openPage(page, ENTRY, "Quiz");
      await expect(page.getByTestId("presidentielle-quiz")).toBeVisible();
      await expect(notice(page, "quiz-indisponible")).toHaveCount(0);
      await openPage(page, ENTRY, "Assistant");
      await expect(page.getByTestId("presidentielle-assistant")).toBeVisible();
      await expect(page.getByRole("textbox").first()).toBeEnabled();
    }

    test("P27-E-50 : entre les deux tours, liste réduite aux 2 qualifiés", async ({
      page,
    }) => {
      usePhase("entre_tours");
      await openCandidates(page);
      await expect(cards(page)).toHaveCount(2);
      expect([...(await shownOrder(page))].sort()).toEqual(QUALIFIES);
      await expect(page.locator("main")).not.toContainText("Carla Exemplia");
      const banner = notice(page, "entre-tours");
      await expect(banner).toContainText("Entre les deux tours");
      await expect(banner).toContainText("deux candidats qualifiés");
      await expect(notice(page, "archive")).toHaveCount(0);
      // Mesure ajoutée après le premier tour : marquée, les autres non
      await openDetail(page, "Aline Fictiva");
      const marks = detail(page).locator("[data-entre-tours]");
      await expect(marks).toHaveCount(1);
      await expect(marks).toContainText("Entre les deux tours");
      await expect(marks).toContainText("20 avril 2027");
      await quizAndAssistantOpen(page);
      await expect(notice(page, "entre-tours")).toBeVisible();
      expect(
        api.writes().filter((c) => c.path.startsWith("/api/presidentielle")),
      ).toEqual([]);
    });

    test("P27-E-51 : archive, bandeau « base figée au 2 mai 2027 »", async ({
      page,
    }) => {
      usePhase("archive");
      await openCandidates(page);
      const banner = notice(page, "archive");
      await expect(banner).toContainText("Base figée au 2 mai 2027");
      await expect(banner).toContainText("restent consultables");
      await expect(cards(page)).toHaveCount(2);
      await expect(notice(page, "entre-tours")).toBeVisible();
      await quizAndAssistantOpen(page);
      await expect(notice(page, "archive")).toBeVisible();
      await openPage(page, ENTRY, "Méthode");
      await expect(notice(page, "archive")).toBeVisible();
      // Hors de ces phases : aucun des deux bandeaux
      api.set("presidentielle", base());
      api.set("presidentielle/meta", meta());
      await openPage(page, ENTRY, "Candidats");
      await expect(cards(page)).toHaveCount(4);
      await expect(notice(page, "archive")).toHaveCount(0);
      await expect(notice(page, "entre-tours")).toHaveCount(0);
    });
  });

  test.describe("évolution des fiches et des programmes", () => {
    const evolution = (page: Page) =>
      page.getByTestId("presidentielle-evolution");

    async function openEvolution(page: Page, name: string) {
      await openCandidates(page);
      await openDetail(page, name);
      await detail(page).getByRole("tab", { name: "Évolution" }).click();
      await expect(evolution(page)).toBeVisible();
    }

    test("P27-E-60 : frise des versions, plus récente en haut", async ({
      page,
    }) => {
      await openEvolution(page, "Carla Exemplia");
      const versions = evolution(page).locator("[data-version]");
      await expect(versions).toHaveCount(2);
      expect(
        await versions.evaluateAll((nodes) =>
          nodes.map((n) => n.getAttribute("data-version")),
        ),
      ).toEqual(["2", "1"]);
      const v2 = versions.first();
      await expect(v2).toContainText("20 novembre 2026");
      await expect(v2).toContainText("Ajout d'une mesure sur les institutions");
      await expect(v2.locator('[data-changement="ajoutees"]')).toContainText(
        "Un référendum d'initiative citoyenne",
      );
      const reformulees = v2.locator('[data-changement="reformulees"]');
      await expect(reformulees).toContainText("Avant");
      await expect(reformulees).toContainText(
        "Chaque canton aura son centre de santé public, avec des médecins salariés.",
      );
      await expect(reformulees.locator("[data-source]").first()).toBeVisible();
      await expect(versions.nth(1)).toContainText(
        "Première version conservée : 3 mesures",
      );
      // Constats seulement : aucun qualificatif
      await expect(evolution(page)).not.toContainText(
        /revirement|recul|volte-face|progrès/i,
      );
      expect(
        api.calls
          .filter((c) => c.path.includes("/evolution/"))
          .map((c) => c.path),
      ).toEqual(["/api/presidentielle/evolution/carla-exemplia"]);
      // Méthode : évolution et limite décrites
      await openPage(page, ENTRY, "Méthode");
      const methode = page.locator('[data-methode="evolution"]');
      await expect(methode).toContainText("mot pour mot");
      await expect(methode).toContainText("ne sont pas récupérables");
    });

    test("P27-E-61 : comparaison mot pour mot de deux versions du programme", async ({
      page,
    }) => {
      await openEvolution(page, "Carla Exemplia");
      const programme = evolution(page).locator('[data-rubrique="programmes"]');
      await expect(programme.locator("[data-document]")).toHaveCount(2);
      await expect(
        programme.getByRole("radio", { name: /version 1/ }).first(),
      ).toBeChecked();
      await programme
        .getByRole("button", { name: "Comparer les deux versions" })
        .click();
      const comparaison = page.getByTestId("presidentielle-comparaison");
      await expect(comparaison).toBeVisible();
      const modifie = comparaison
        .locator('[data-bloc="modifie"]')
        .filter({ hasText: "titre de séjour" });
      await expect(modifie).toContainText("page 11 → page 10");
      await expect(modifie.locator("del")).toContainText("trois");
      await expect(modifie.locator("ins")).toContainText("deux");
      await expect(
        comparaison.locator('[data-bloc="ajoute"]').first(),
      ).toBeVisible();
      await expect(
        comparaison.locator('[data-bloc="retire"]').first(),
      ).toBeVisible();
      const call = api.calls.find((c) => c.path.endsWith("/comparaison"));
      expect(call?.method).toBe("GET");
      // Parcours des citations : disparition dans la version révisée
      const parcours = programme.locator(
        '[data-parcours="immigration-titres"]',
      );
      await expect(parcours).toContainText("version 1");
      await expect(parcours).toContainText(
        "version 2 (publiée le 19 novembre 2026)",
      );
      await expect(
        programme.locator('[data-parcours="eco-bareme"]'),
      ).toContainText("page 2");
    });

    test("P27-E-62 : même gabarit pour chaque candidat, onglets au clavier", async ({
      page,
    }) => {
      await openCandidates(page);
      for (const candidat of base().candidats) {
        await openDetail(page, candidat.nom_affiche);
        await detail(page).getByRole("tab", { name: "Évolution" }).click();
        await expect(
          evolution(page).locator('[data-rubrique="versions-fiche"]'),
        ).toBeVisible();
        await expect(
          evolution(page).locator('[data-rubrique="programmes"]'),
        ).toBeVisible();
        await page.getByRole("button", { name: "Retour à la liste" }).click();
      }
      await openDetail(page, "Aline Fictiva");
      const fiche = detail(page).getByRole("tab", { name: "Fiche" });
      await expect(fiche).toHaveAttribute("aria-selected", "true");
      await fiche.focus();
      await page.keyboard.press("ArrowRight");
      await expect(
        detail(page).getByRole("tab", { name: "Évolution" }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(evolution(page)).toContainText(
        "Aucun document de programme en plusieurs versions à ce jour",
      );
      await expect(evolution(page).locator("[data-version]")).toHaveCount(1);
      expect(
        api.writes().filter((c) => c.path.startsWith("/api/presidentielle")),
      ).toEqual([]);
    });

    test("P27-E-66 : mesure retirée pour erreur, texte absent de toute la frise", async ({
      page,
    }) => {
      // Sortie du routeur après publier --retrait-erreur sante-centres (version 3) :
      // la mesure n'est plus décrite que par la date du retrait, en v3 comme en v2
      const routes = read("presidentielle_evolution");
      const carla = routes["presidentielle/evolution/carla-exemplia"];
      const masquee = { id: "sante-centres", retrait_erreur: "2026-11-21" };
      const [v2, v1] = carla.versions;
      api.set("presidentielle/evolution/carla-exemplia", {
        ...carla,
        version: 3,
        // Fiche publiée en v3 : la mesure n'y est plus, donc hors du parcours des
        // citations
        programmes: carla.programmes.map(
          (p: { mesures: { mesure: { id: string } }[] }) => ({
            ...p,
            mesures: p.mesures.filter((m) => m.mesure.id !== "sante-centres"),
          }),
        ),
        versions: [
          {
            ...v2,
            version: 3,
            date: "2026-11-21",
            motif: "Erreur de saisie corrigée",
            comparee_a: 2,
            changements: {
              mesures_ajoutees: [],
              mesures_retirees: [masquee],
              mesures_reformulees: [],
              nouvelles_sources: [],
              statut: null,
            },
          },
          {
            ...v2,
            changements: {
              ...v2.changements,
              mesures_reformulees: [
                {
                  id: "sante-centres",
                  citation_modifiee: true,
                  avant: masquee,
                  apres: masquee,
                },
              ],
            },
          },
          v1,
        ],
      });
      await openEvolution(page, "Carla Exemplia");
      const versions = evolution(page).locator("[data-version]");
      await expect(versions).toHaveCount(3);
      const label =
        "Mesure retirée le 21 novembre 2026 (erreur de saisie corrigée)";
      const v3 = versions.first();
      await expect(
        v3.locator('[data-changement="retirees"] [data-retrait-erreur]'),
      ).toHaveText(label);
      const reformulee = versions
        .nth(1)
        .locator('[data-changement="reformulees"] li');
      await expect(reformulee).toHaveCount(1);
      await expect(reformulee).toHaveText(label);
      await expect(reformulee).not.toContainText("Citation modifiée");
      // Ni citation, ni source, ni thème de la mesure retirée
      await expect(evolution(page)).not.toContainText("centre de santé public");
      await expect(evolution(page)).not.toContainText("médecins salariés");
      await expect(
        evolution(page).locator("[data-retrait-erreur] [data-source]"),
      ).toHaveCount(0);
      // Les autres mesures gardent leur citation
      await expect(
        versions.nth(1).locator('[data-changement="ajoutees"]'),
      ).toContainText("Un référendum d'initiative citoyenne");
      // Méthode : règle décrite
      await openPage(page, ENTRY, "Méthode");
      await expect(page.locator('[data-methode="evolution"]')).toContainText(
        "seule la date du retrait est indiquée",
      );
    });

    test.describe("refus du routeur", () => {
      // Le navigateur journalise la réponse 404 simulée
      test.use({ allowConsoleErrors: ["status of 404"] });

      test("P27-E-63 : lecture impossible, la fiche reste consultable", async ({
        page,
      }) => {
        api.on(/^GET \/api\/presidentielle\/evolution\//, (route) =>
          route.fulfill({ status: 404, json: { detail: "candidat inconnu" } }),
        );
        await openEvolution(page, "Bruno Démonstra");
        await expect(evolution(page).getByRole("alert")).toContainText(
          "candidat inconnu",
        );
        await detail(page).getByRole("tab", { name: "Fiche" }).click();
        await expect(
          detail(page).getByTestId("presidentielle-themes"),
        ).toBeVisible();
      });
    });
  });

  test.describe("base sans grille du quiz", () => {
    // Variantes tirées du routeur (test_presidentielle_sans_grille.py) : jeu fictif
    // sans quiz/, et 27 fiches d'identité sans mesure ni grille (cas de la base réelle)
    function useVariant(name: "sans_grille" | "identites") {
      const variant = read(`presidentielle_${name}`) as Record<string, unknown>;
      for (const [key, value] of Object.entries(variant)) {
        if (key.startsWith("presidentielle")) api.set(key, value);
      }
      return variant;
    }

    async function quizUnavailable(page: Page) {
      await page.goto("./#/presidentielle-2027/quiz");
      await expect(notice(page, "quiz-indisponible")).toContainText(
        "La grille du quiz n'est pas encore publiée.",
      );
      await expect(notice(page, "quiz-indisponible")).not.toContainText(
        "assez couverte",
      );
      await expect(page.getByTestId("presidentielle-quiz")).toHaveCount(0);
    }

    test("P27-E-64 : grille absente, mesures visibles sous des thèmes déduits", async ({
      page,
    }) => {
      const variant = useVariant("sans_grille");
      api.on(/^POST \/api\/presidentielle\/ask$/, (route) =>
        route.fulfill({ json: variant.ask_theme }),
      );
      const data = variant.presidentielle as Base;
      const aline = data.candidats.find((c) => c.id === "aline-fictiva");
      expect(aline?.mesures.length).toBeGreaterThan(0);
      await openCandidates(page);
      await openDetail(page, "Aline Fictiva");
      const themes = detail(page).getByTestId("presidentielle-themes");
      await expect(themes.locator("[data-theme]")).toHaveCount(
        data.themes.length,
      );
      await expect(themes.locator("[data-mesure]")).toHaveCount(
        aline?.mesures.length ?? 0,
      );
      await expect(themes.locator('[data-theme="sante"]')).toContainText(
        "Santé",
      );
      await expect(
        detail(page).getByTestId("presidentielle-sans-mesure"),
      ).toHaveCount(0);
      // Méthode : aucun axe publié, dit en clair
      await openPage(page, ENTRY, "Méthode");
      await expect(page.getByTestId("presidentielle-sans-axes")).toContainText(
        "La grille du quiz n'est pas encore publiée.",
      );
      // Assistant : thème reconnu, libellé affiché (jamais l'identifiant brut)
      await openPage(page, ENTRY, "Assistant");
      const input = page.getByLabel("Votre question");
      await input.fill("Que propose Aline Fictiva sur la santé ?");
      await input.press("Enter");
      const reponse = page.getByTestId("presidentielle-reponse");
      await expect(reponse.locator('[data-theme="sante"]').first()).toHaveText(
        "Santé",
      );
      await quizUnavailable(page);
    });

    test("P27-E-65 : 27 fiches d'identité, même gabarit, rien d'inventé", async ({
      page,
    }) => {
      const variant = useVariant("identites");
      api.on(/^POST \/api\/presidentielle\/ask$/, (route) =>
        route.fulfill({ json: variant.ask_recherche }),
      );
      await openCandidates(page);
      await expect(cards(page)).toHaveCount(27);
      // Même gabarit : « Aucune ligne phare » sur chaque carte
      await expect(
        cards(page).filter({ hasText: "Aucune ligne phare annoncée" }),
      ).toHaveCount(27);
      await expect(cards(page).filter({ hasText: "Retiré" })).toHaveCount(1);
      await openDetail(page, "Adèle Fictilier");
      await expect(detail(page)).toContainText("Aucune ligne phare annoncée");
      await expect(
        detail(page).getByTestId("presidentielle-sans-mesure"),
      ).toHaveText("Aucune mesure relue à ce jour");
      await expect(detail(page).locator("[data-theme]")).toHaveCount(0);
      // Évolution : version 1 seulement
      await detail(page).getByRole("tab", { name: "Évolution" }).click();
      const evolution = page.getByTestId("presidentielle-evolution");
      await expect(evolution.locator("[data-version]")).toHaveCount(1);
      await expect(evolution.locator('[data-version="1"]')).toBeVisible();
      // Assistant : réponse sans modèle, aucune citation
      await openPage(page, ENTRY, "Assistant");
      const input = page.getByLabel("Votre question");
      await input.fill("Que prévoient-ils pour les réacteurs ?");
      await input.press("Enter");
      const reponse = page.getByTestId("presidentielle-reponse");
      await expect(reponse).toContainText(
        "Je ne peux pas le confirmer depuis la base.",
      );
      await expect(reponse.locator("[data-passage]")).toHaveCount(0);
      await expect(page.getByTestId("presidentielle-modele")).toHaveCount(0);
      await quizUnavailable(page);
      expect(
        api
          .writes()
          .filter(
            (c) =>
              c.path.startsWith("/api/presidentielle") &&
              c.path !== "/api/presidentielle/ask",
          ),
      ).toEqual([]);
    });
  });
});
