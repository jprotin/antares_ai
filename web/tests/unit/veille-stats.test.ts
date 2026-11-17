// Statistiques de la veille : contrôle de la réponse, anneaux, échelles, libellés, appel
import { afterEach, describe, expect, test, vi } from "vitest";

import { loadStats } from "@/features/veille/api";
import {
  agreementByDay,
  articles,
  donutPaths,
  niceMax,
  parseStats,
  percent,
  seriesSlot,
  shortDay,
} from "@/features/veille/stats";

import fixture from "../fixtures/api/veille_stats.json";

const CATEGORIES = [
  { slug: "ia", label: "IA" },
  { slug: "cloud", label: "Cloud" },
];

describe("statistiques", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("test_lecture_de_la_fixture", () => {
    const stats = parseStats(fixture);
    expect(stats?.summary.agreement).toBe(68.4);
    expect(stats?.tastes.categories[0]).toEqual({
      slug: "ia",
      label: "IA",
      count: 19,
      share: 45.2,
      dislikes: 4,
    });
    expect(stats?.ai.sources[2]?.selection_rate).toBe(35);
    expect(stats?.timeline).toHaveLength(14);
  });

  test("test_reponse_degradee", () => {
    expect(parseStats(null)).toBeNull();
    expect(parseStats({ summary: [] })).toBeNull();
    const stats = parseStats({
      days: "x",
      summary: { likes: -3, agreement: "haut", featured: 4 },
      tastes: {
        categories: [{ slug: "ia", count: 2, dislikes: "x" }, "y"],
        sources: [{ name: "" }, { name: "Next", like_rate: 50 }],
        words: [{ word: "agents", count: 2 }, { count: 1 }],
      },
      ai: "rien",
      timeline: [
        { day: "2026-11-16", featured: { ia: 3, cloud: "x" } },
        { day: "hier" },
        { day: "2026-11-17", featured: [] },
      ],
    });
    expect(stats?.days).toBe(0);
    expect(stats?.summary.likes).toBe(0);
    expect(stats?.summary.agreement).toBeNull();
    expect(stats?.summary.featured).toBe(4);
    expect(stats?.tastes.categories).toEqual([
      { slug: "ia", label: "ia", count: 2, share: null, dislikes: 0 },
    ]);
    expect(stats?.tastes.sources).toEqual([
      { name: "Next", likes: 0, dislikes: 0, like_rate: 50 },
    ]);
    expect(stats?.tastes.words).toEqual([{ word: "agents", count: 2 }]);
    expect(stats?.ai).toEqual({ categories: [], sources: [] });
    expect(stats?.timeline.map((d) => d.featured)).toEqual([
      { ia: 3, cloud: 0 },
      {},
    ]);
    expect(
      parseStats({ summary: {}, tastes: { categories: [{}] } })?.tastes
        .categories[0]?.label,
    ).toBe("Autre");
  });

  test("test_libelles", () => {
    expect(percent(66.7)).toBe("66,7 %");
    expect(percent(50)).toBe("50 %");
    expect(percent(null)).toBe("–");
    expect(seriesSlot("cloud", CATEGORIES)).toBe(2);
    expect(seriesSlot("sport", CATEGORIES)).toBe(0);
    const seven = Array.from({ length: 7 }, (_, i) => ({
      slug: `c${i}`,
      label: "",
    }));
    expect(seriesSlot("c6", seven)).toBe(0);
    expect(shortDay("2026-11-16")).toBe("16 nov.");
    expect(shortDay("pas un jour")).toBe("pas un jour");
    expect(articles(1)).toBe("1 article");
    expect(articles(3)).toBe("3 articles");
  });

  test("test_echelle", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(13)).toBe(20);
    expect(niceMax(42)).toBe(50);
    expect(niceMax(100)).toBe(100);
  });

  test("test_anneau", () => {
    expect(donutPaths([0, 0], 50, 32)).toEqual([]);
    const full = donutPaths([0, 5], 50, 32);
    expect(full).toHaveLength(1);
    expect(full[0]?.index).toBe(1);
    expect(full[0]?.path).toContain("A 50 50 0 1 1 0 50");
    const parts = donutPaths([3, 1, 0], 50, 32);
    expect(parts.map((p) => p.index)).toEqual([0, 1]);
    // Grand secteur (3/4) : drapeau d'arc large
    expect(parts[0]?.path).toMatch(/A 50 50 0 1 1/);
    expect(parts[1]?.path).toMatch(/A 50 50 0 0 1/);
  });

  test("test_taux_d_accord_par_jour", () => {
    expect(
      agreementByDay([
        {
          day: "2026-11-16",
          featured: {},
          agree_likes: 2,
          agree_dislikes: 1,
          missed_likes: 0,
        },
        {
          day: "2026-11-17",
          featured: {},
          agree_likes: 0,
          agree_dislikes: 0,
          missed_likes: 1,
        },
      ]),
    ).toEqual([
      { day: "2026-11-16", value: 66.7 },
      { day: "2026-11-17", value: null },
    ]);
  });

  test("test_appel_du_routeur", async () => {
    const fetch = vi.fn((_url: string) =>
      Promise.resolve(new Response(JSON.stringify(fixture), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetch);
    expect((await loadStats(7)).summary.likes).toBe(42);
    expect(fetch.mock.calls[0]?.[0]).toBe("api/veille/stats?days=7");
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response("{}", { status: 200 })),
    );
    await expect(loadStats(30)).rejects.toThrow("illisible");
  });
});
