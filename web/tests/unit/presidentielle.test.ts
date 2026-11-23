// Présidentielle 2027, lot 1 (P27-U-01 à P27-U-08) : tirage au sort de l'ordre des
// candidats (Fisher-Yates, générateur injectable, crypto.getRandomValues en production)
// et ordre de la visite partagé. Propriétés vérifiées par boucles à graine fixe.
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  cryptoRng,
  indexBelow,
  shuffle,
  type Rng,
} from "@/features/presidentielle/shuffle";
import { formatDate, safeUrl } from "@/features/presidentielle/labels";
import {
  inVisitOrder,
  presidentielleStore,
  visitOrder,
} from "@/features/presidentielle/state";
import type { Candidat } from "@/features/presidentielle/types";

// Générateur reproductible (mulberry32) : entiers de 32 bits
function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

const IDS = ["a", "b", "c", "d"];

// Nouvelle visite : l'ordre est oublié (équivaut à recharger l'application)
const newVisit = () => presidentielleStore.setState({ order: null });
const DRAWS = 24_000;

type Shuffler = (items: readonly string[], rng: Rng) => string[];

// Uniformité sur 4 candidats : chaque ordre (24) entre 800 et 1 200 fois, chaque
// candidat premier entre 23 % et 27 % des tirages
function uniformity(shuffler: Shuffler, seed = 20_270_418) {
  const rng = mulberry32(seed);
  const orders = new Map<string, number>();
  const first = new Map<string, number>();
  for (let i = 0; i < DRAWS; i += 1) {
    const order = shuffler(IDS, rng);
    const key = order.join("");
    orders.set(key, (orders.get(key) ?? 0) + 1);
    first.set(order[0] ?? "", (first.get(order[0] ?? "") ?? 0) + 1);
  }
  const counts = [...orders.values()];
  const shares = IDS.map((id) => (first.get(id) ?? 0) / DRAWS);
  const ordersOk =
    orders.size === 24 && counts.every((n) => n >= 800 && n <= 1_200);
  const firstOk = shares.every((share) => share >= 0.23 && share <= 0.27);
  return { ok: ordersOk && firstOk, orders: orders.size, counts, shares };
}

afterEach(() => {
  vi.restoreAllMocks();
  newVisit();
});

describe("tirage au sort (shuffle.ts)", () => {
  test("P27-U-01 : graine fixe, résultat reproductible", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g"];
    expect(shuffle(items, mulberry32(42))).toEqual(
      shuffle(items, mulberry32(42)),
    );
    expect(shuffle(items, mulberry32(42))).not.toEqual(
      shuffle(items, mulberry32(43)),
    );
  });

  test("P27-U-02 : mêmes éléments, sans perte ni doublon, liste d'origine intacte", () => {
    const items = Object.freeze(["a", "b", "c", "d", "e", "f", "g", "h"]);
    const rng = mulberry32(7);
    for (let i = 0; i < 200; i += 1) {
      const result = shuffle(items, rng);
      expect(result).toHaveLength(items.length);
      expect(new Set(result).size).toBe(items.length);
      expect([...result].sort()).toEqual([...items].sort());
      expect(result).not.toBe(items);
    }
    expect(items).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  });

  test("P27-U-03 : listes de 0 et 1 élément renvoyées telles quelles", () => {
    const rng = vi.fn(mulberry32(1));
    expect(shuffle([], rng)).toEqual([]);
    expect(rng).not.toHaveBeenCalled();
    expect(shuffle(["seul"], rng)).toEqual(["seul"]);
    expect(rng).not.toHaveBeenCalled();
  });

  test("P27-U-04 : uniformité sur 4 candidats (24 000 tirages)", () => {
    const result = uniformity((items, rng) => shuffle(items, rng));
    expect(result.orders).toBe(24);
    for (const count of result.counts) {
      expect(count).toBeGreaterThanOrEqual(800);
      expect(count).toBeLessThanOrEqual(1_200);
    }
    for (const share of result.shares) {
      expect(share).toBeGreaterThanOrEqual(0.23);
      expect(share).toBeLessThanOrEqual(0.27);
    }
    expect(result.ok).toBe(true);
  });

  test("P27-U-05 : le détecteur trouve le biais d'un tri aléatoire", () => {
    const biased: Shuffler = (items, rng) =>
      [...items].sort(() => rng() / 2 ** 32 - 0.5);
    expect(uniformity(biased).ok).toBe(false);
  });

  test("P27-U-06 : crypto.getRandomValues en production, jamais Math.random", () => {
    const crypto = vi.spyOn(globalThis.crypto, "getRandomValues");
    const random = vi.spyOn(Math, "random");
    const result = shuffle(IDS);
    expect([...result].sort()).toEqual(IDS);
    expect(crypto).toHaveBeenCalledTimes(IDS.length - 1);
    expect(random).not.toHaveBeenCalled();
    const value = cryptoRng();
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(2 ** 32);
  });

  test("P27-U-07 : 0 et 2³²−1 donnent un indice valide", () => {
    for (const size of [1, 2, 3, 4, 7, 12, 50]) {
      expect(indexBelow(size, () => 0)).toBe(0);
      expect(indexBelow(size, () => 2 ** 32 - 1)).toBe(size - 1);
    }
    // Valeurs hors intervalle ramenées dans l'intervalle
    expect(indexBelow(4, () => -5)).toBe(0);
    expect(indexBelow(4, () => 2 ** 40)).toBe(3);
    for (const extreme of [0, 2 ** 32 - 1]) {
      const result = shuffle(IDS, () => extreme);
      expect([...result].sort()).toEqual(IDS);
    }
  });
});

describe("ordre de la visite (state.ts)", () => {
  test("P27-U-08 : tiré une fois, partagé, nouveau tirage à la visite suivante", () => {
    newVisit();
    const first = vi.fn(mulberry32(11));
    const page = visitOrder(IDS, first);
    const calls = first.mock.calls.length;
    expect(calls).toBe(IDS.length - 1);
    // L'assistant et le rapport lisent le même ordre, sans nouveau tirage
    const other = vi.fn(mulberry32(99));
    const assistant = visitOrder([...IDS].reverse(), other);
    const report = visitOrder(IDS, other);
    expect(assistant).toEqual(page);
    expect(report).toEqual(page);
    expect(other).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledTimes(calls);
    // Visite suivante : nouveau tirage
    newVisit();
    const next = vi.fn(mulberry32(99));
    const again = visitOrder(IDS, next);
    expect(next).toHaveBeenCalledTimes(IDS.length - 1);
    expect(again).toEqual(shuffle(IDS, mulberry32(99)));
    // Liste des candidats changée : nouveau tirage, sur la nouvelle liste
    const changed = visitOrder([...IDS, "e"], mulberry32(5));
    expect([...changed].sort()).toEqual([...IDS, "e"]);
  });

  test("candidats rangés dans l'ordre de la visite", () => {
    const candidat = (id: string) => ({ id }) as Candidat;
    const list = ["a", "b", "c", "x"].map(candidat);
    expect(inVisitOrder(list, ["c", "a", "b"]).map((c) => c.id)).toEqual([
      "c",
      "a",
      "b",
      "x",
    ]);
    expect(inVisitOrder(list, null).map((c) => c.id)).toEqual([
      "a",
      "b",
      "c",
      "x",
    ]);
  });
});

describe("libellés (labels.ts)", () => {
  test("safeUrl : seules les adresses https deviennent des liens", () => {
    expect(safeUrl("https://exemple.invalid/programme.pdf")).toBe(
      "https://exemple.invalid/programme.pdf",
    );
    for (const value of [
      "http://exemple.invalid/",
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "/relative/chemin",
      "programme.pdf",
      "",
    ])
      expect(safeUrl(value), value).toBeNull();
  });

  test("formatDate : date lisible, valeur illisible rendue telle quelle", () => {
    expect(formatDate("2026-11-20")).toBe("20 novembre 2026");
    expect(formatDate("2026-13-45")).toBe("2026-13-45");
    expect(formatDate("pas une date")).toBe("pas une date");
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
  });
});
