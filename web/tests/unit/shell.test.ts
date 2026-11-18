// Ossature : adresse -> page (router.ts, pages.ts) et sélection des articles du tableau
// de bord (features/home/home.ts)
import { describe, expect, test, vi } from "vitest";

import { routeOf } from "@/app/router";
import { dayTop, weekTop } from "@/features/home/home";
import type { VeilleItem, VeilleRun } from "@/types/api";

vi.mock("@/app/runtime", () => ({ avatar: {}, engine: {} }));

function item(id: string, changes: Partial<VeilleItem> = {}): VeilleItem {
  return {
    id,
    title: `Article ${id}`,
    url: `https://exemple.fr/${id}`,
    source: "Source",
    lang: "fr",
    category: "ia",
    sentence: "",
    summary: "",
    published_at: "2026-11-18T08:00:00Z",
    vote: null,
    ...changes,
  };
}

function run(id: number, finished: string, items: VeilleItem[]): VeilleRun {
  return {
    id,
    schema: 2,
    day: finished.slice(0, 10),
    slot_at: null,
    started_at: finished,
    finished_at: finished,
    status: "done",
    model: "gemma4:e4b",
    items,
    ideas: [],
    errors: [],
    manual: false,
  };
}

describe("adresse", () => {
  test("test_routeOf_vide_donne_accueil", () => {
    expect(routeOf("")).toBe("accueil");
    expect(routeOf("#/")).toBe("accueil");
  });

  test("test_routeOf_garde_la_sous_page_sans_barre_finale", () => {
    expect(routeOf("#/reglages/agents/")).toBe("reglages/agents");
    expect(routeOf("#conversation")).toBe("conversation");
  });
});

describe("tableau de bord", () => {
  test("test_dayTop_aimes_en_tete_rejetes_ecartes_limite_5", () => {
    const runs = [
      run(1, "2026-11-18T07:00:00Z", [
        item("a"),
        item("b", { vote: "dislike" }),
        item("c"),
        item("d"),
        item("e"),
        item("f"),
        item("g", { vote: "like" }),
      ]),
    ];
    expect(dayTop(runs).map((i) => i.id)).toEqual(["g", "a", "c", "d", "e"]);
  });

  test("test_dayTop_passages_fusionnes_le_plus_recent_d_abord", () => {
    const runs = [
      run(1, "2026-11-18T07:00:00Z", [item("a"), item("b")]),
      run(2, "2026-11-18T12:00:00Z", [item("c"), item("a")]),
    ];
    expect(dayTop(runs).map((i) => i.id)).toEqual(["c", "a", "b"]);
  });

  test("test_weekTop_aimes_de_la_semaine_puis_une_de_chaque_jour", () => {
    const today = [
      run(2, "2026-11-18T07:00:00Z", [item("t1"), item("t2"), item("t3")]),
    ];
    const yesterday = [
      run(1, "2026-11-17T07:00:00Z", [
        item("y1"),
        item("y2", { vote: "like", published_at: "2026-11-17T06:00:00Z" }),
      ]),
    ];
    expect(weekTop([today, yesterday]).map((i) => i.id)).toEqual([
      "y2",
      "t1",
      "t2",
      "y1",
    ]);
  });

  test("test_weekTop_vide_sans_passage", () => {
    expect(weekTop([[], []])).toEqual([]);
  });
});
