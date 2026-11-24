// Présidentielle 2027, vue « Évolution » (P27-U-70 à P27-U-75) : contrôle de forme des
// réponses du routeur (évolution d'une fiche, comparaison de deux versions d'un
// document) et adresse des requêtes (identifiants encodés, lecture GET seulement).
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  checkedComparaison,
  checkedEvolution,
  loadComparaison,
  loadEvolution,
  PresidentielleApiError,
} from "@/features/presidentielle/api";
import {
  retireeErreur,
  retraitErreurLabel,
} from "@/features/presidentielle/labels";
import type { Comparaison, Evolution } from "@/features/presidentielle/types";

import routes from "../fixtures/api/presidentielle_evolution.json";

const carla = routes[
  "presidentielle/evolution/carla-exemplia"
] as unknown as Evolution;
const comparaison = routes[
  "presidentielle/evolution/carla-exemplia/comparaison"
] as unknown as Comparaison;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("évolution d'une fiche", () => {
  test("P27-U-70 : réponse du routeur acceptée telle quelle", () => {
    const checked = checkedEvolution(carla);
    expect(checked.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(checked.programmes).toHaveLength(1);
    expect(checked.programmes[0]?.versions.map((v) => v.id)).toEqual([
      "carla-programme",
      "carla-programme-2",
    ]);
  });

  test("P27-U-71 : réponse illisible refusée, éléments mal formés écartés", () => {
    expect(() => checkedEvolution({} as Evolution)).toThrow(
      PresidentielleApiError,
    );
    const programme = carla.programmes[0];
    const checked = checkedEvolution({
      ...carla,
      versions: [null, { version: "2" }, ...carla.versions] as never,
      programmes: [
        { ...programme, versions: programme?.versions.slice(0, 1) },
        { ...programme, mesures: undefined },
        programme,
      ] as never,
    });
    expect(checked.versions).toHaveLength(2);
    expect(checked.programmes).toHaveLength(1);
  });

  test("P27-U-74 : changements partiels complétés par des listes vides", () => {
    const [v2] = carla.versions;
    const checked = checkedEvolution({
      ...carla,
      versions: [{ ...v2, changements: { statut: null } }] as never,
    });
    expect(checked.versions[0]?.changements).toEqual({
      mesures_ajoutees: [],
      mesures_retirees: [],
      mesures_reformulees: [],
      nouvelles_sources: [],
      statut: null,
    });
  });

  test("P27-U-75 : mesure retirée pour erreur, identifiant et date seulement", () => {
    const [v2] = carla.versions;
    const changements = v2?.changements;
    const ajoutee = changements?.mesures_ajoutees[0];
    // Réponse qui renverrait encore le texte : jamais transmis au rendu
    const fuite = {
      ...ajoutee,
      id: "sante-centres",
      retrait_erreur: "2026-11-21",
    } as never;
    const checked = checkedEvolution({
      ...carla,
      versions: [
        {
          ...v2,
          changements: {
            ...changements,
            mesures_retirees: [fuite],
            mesures_reformulees: [
              {
                id: "sante-centres",
                citation_modifiee: true,
                avant: fuite,
                apres: fuite,
              },
            ],
          },
        },
      ] as never,
    });
    const masquee = { id: "sante-centres", retrait_erreur: "2026-11-21" };
    const resultat = checked.versions[0]?.changements;
    expect(resultat?.mesures_retirees).toEqual([masquee]);
    expect(resultat?.mesures_reformulees[0]?.avant).toEqual(masquee);
    expect(resultat?.mesures_reformulees[0]?.apres).toEqual(masquee);
    // Les autres mesures gardent citation et source
    expect(resultat?.mesures_ajoutees).toEqual(changements?.mesures_ajoutees);
    expect(retireeErreur(masquee)).toBe(true);
    expect(retireeErreur(ajoutee as never)).toBe(false);
    expect(retraitErreurLabel("2026-11-21")).toBe(
      "Mesure retirée le 21 novembre 2026 (erreur de saisie corrigée)",
    );
  });

  test("P27-U-72 : blocs de comparaison mal formés écartés", () => {
    expect(() => checkedComparaison({} as Comparaison)).toThrow(
      PresidentielleApiError,
    );
    const checked = checkedComparaison({
      ...comparaison,
      blocs: [null, { type: "resume" }, ...comparaison.blocs] as never,
    });
    expect(checked.blocs).toEqual(comparaison.blocs);
    expect(checked.blocs.map((b) => b.type)).toContain("modifie");
  });

  test("P27-U-73 : requêtes GET, identifiants encodés", async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(url.includes("comparaison") ? comparaison : carla),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await loadEvolution("carla-exemplia");
    await loadComparaison("carla-exemplia", "carla-programme", "a&b=c");
    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls).toEqual([
      "api/presidentielle/evolution/carla-exemplia",
      "api/presidentielle/evolution/carla-exemplia/comparaison?de=carla-programme&a=a%26b%3Dc",
    ]);
    for (const [, init] of fetchMock.mock.calls as unknown as [
      string,
      RequestInit | undefined,
    ][])
      expect(init?.method ?? "GET").toBe("GET");
  });
});
