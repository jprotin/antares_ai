// Veille IA et météo : pastille, liens sûrs, contrôle des réponses (schémas 1 et 2),
// filtres, votes, dessin de la météo, copie, heures de Paris, appels du routeur
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  addSource,
  deleteSource,
  loadFavorites,
  loadIdeaPrompt,
  loadOthers,
  loadRunStatus,
  loadSources,
  requestRun,
  setFavorite,
  translateArticle,
  retryable,
  sendVote,
  setBuiltinEnabled,
  testSource,
  updateSource,
  VeilleApiError,
} from "@/features/veille/api";
import {
  activeFilters,
  categoriesOf,
  categoryColor,
  categoryLabel,
  copyText,
  countLabel,
  dayIdeas,
  dayItems,
  degrees,
  EMPTY_SOURCE,
  filterItems,
  filterSources,
  fold,
  formatDateTime,
  formatDay,
  formatHour,
  formatTime,
  hasNews,
  isNewRun,
  lastRun,
  nextVote,
  NO_FILTERS,
  openedStamp,
  parseDay,
  parseLatest,
  parseOthers,
  parseRun,
  parseRunStatus,
  parseStamp,
  parseWeather,
  probeSummary,
  relativeTime,
  runBusy,
  runOutcome,
  runsLabel,
  safeHref,
  sortOthers,
  sourceHost,
  sourceInitials,
  sourceReady,
  sourcesOf,
  voteKey,
  weatherArt,
  weatherKey,
  weatherLabel,
} from "@/features/veille/veille";
import type {
  VeilleItem,
  VeilleOther,
  VeilleRun,
  VeilleWeatherKey,
} from "@/types/api";

import latestFixture from "../fixtures/api/veille_latest.json";

const AT_13 = "2026-11-16T12:00:30+00:00";

function latest() {
  const parsed = parseLatest(latestFixture);
  if (!parsed?.run) throw new Error("fixture illisible");
  return { ...parsed, run: parsed.run };
}

function item(changes: Partial<VeilleItem>): VeilleItem {
  return {
    id: null,
    title: "Titre",
    url: "https://example.com/a",
    source: "Source",
    lang: "en",
    category: "ia",
    sentence: "Phrase.",
    summary: "",
    published_at: null,
    vote: null,
    ...changes,
  };
}

describe("pastille", () => {
  test("test_hasNews_jamais_ouverte_allumee", () => {
    expect(hasNews(AT_13, null)).toBe(true);
    expect(hasNews(AT_13, undefined)).toBe(true);
  });

  test("test_hasNews_comparaison_des_dates", () => {
    expect(hasNews(AT_13, "2026-11-16T08:00:00.000Z")).toBe(true);
    expect(hasNews(AT_13, "2026-11-16T13:00:00.000Z")).toBe(false);
    expect(hasNews(AT_13, "2026-11-16T12:00:30.000Z")).toBe(false);
  });

  test("test_hasNews_sans_passage_eteinte", () => {
    expect(hasNews(null, null)).toBe(false);
    expect(hasNews(undefined, "2026-11-16T08:00:00Z")).toBe(false);
  });

  test("test_hasNews_date_stockee_corrompue_comme_absente", () => {
    expect(hasNews(AT_13, "pas une date")).toBe(true);
    expect(parseStamp("")).toBeNull();
    expect(parseStamp("2026-13-45")).toBeNull();
  });

  test("test_passage_failed_allume_missed_non", () => {
    const failed = parseLatest({
      ...latestFixture,
      run: { ...latestFixture.run, status: "failed" },
    });
    expect(failed?.run?.status).toBe("failed");
    expect(hasNews(failed?.run?.finished_at, "2026-11-16T09:00:00Z")).toBe(
      true,
    );
    const missedOnly = parseLatest({ ...latestFixture, run: null });
    expect(missedOnly?.missed.length).toBeGreaterThan(0);
    expect(hasNews(missedOnly?.run?.finished_at, null)).toBe(false);
  });

  test("test_openedStamp_maintenant_ou_passage_plus_recent", () => {
    const now = new Date("2026-11-16T13:00:00Z");
    expect(openedStamp(now, AT_13)).toBe("2026-11-16T13:00:00.000Z");
    expect(openedStamp(now, "2026-11-16T14:00:00Z")).toBe(
      "2026-11-16T14:00:00.000Z",
    );
    expect(openedStamp(now, null)).toBe("2026-11-16T13:00:00.000Z");
  });

  test("test_nouveau_passage_termine_apres_ouverture_precedente", () => {
    const run = { finished_at: AT_13 };
    expect(isNewRun(run, "2026-11-16T08:00:00Z")).toBe(true);
    expect(isNewRun(run, "2026-11-16T13:00:00Z")).toBe(false);
    expect(isNewRun(run, null)).toBe(true);
    expect(isNewRun(null, null)).toBe(false);
  });
});

describe("liens", () => {
  test("test_safeHref_http_et_https_acceptes", () => {
    expect(safeHref("https://openai.com/index/a")).toBe(
      "https://openai.com/index/a",
    );
    expect(safeHref(" http://ex.com/a ")).toBe("http://ex.com/a");
  });

  test.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "data:text/html,x",
    "vbscript:msgbox(1)",
    "/relatif",
    "",
    "https://",
    "http://exa mple.com",
  ])("test_safeHref_refuse_%s", (url) => {
    expect(safeHref(url)).toBeNull();
  });

  test("test_safeHref_valeur_non_texte", () => {
    expect(safeHref(undefined)).toBeNull();
    expect(safeHref(42)).toBeNull();
  });
});

describe("réponses du routeur", () => {
  test("test_parseLatest_fixture_schema_2", () => {
    const { run, weather, categories, days } = latest();
    expect(run.schema).toBe(2);
    expect(run.items).toHaveLength(20);
    expect(run.ideas).toHaveLength(6);
    expect(run.items[0]).toMatchObject({
      id: "a000000000000001",
      lang: "en",
      category: "cloud",
      vote: "like",
    });
    expect(run.ideas[0]).toMatchObject({ vote: "like", has_prompt: true });
    expect(run.ideas[0]?.inspired_by?.title).toContain("Mistral");
    expect(days).toEqual(["2026-11-16", "2026-11-15", "2026-11-14"]);
    expect(categories).toHaveLength(6);
    expect(weather?.condition).toEqual({
      code: 61,
      key: "rain",
      label: "Pluie",
      is_day: true,
    });
    expect(weather?.hours).toHaveLength(12);
    expect(weather?.today?.max).toBe(12);
  });

  test.each([[], {}, null, "x", 3])(
    "test_parseLatest_forme_inattendue_%j",
    (value) => {
      expect(parseLatest(value)).toBeNull();
    },
  );

  test("test_parseLatest_champs_douteux_nettoyes", () => {
    const parsed = parseLatest({
      run: {
        id: "x",
        finished_at: AT_13,
        status: "bizarre",
        items: [
          { title: "T", id: "ABC", lang: "de", vote: "super" },
          { url: "sans titre" },
          3,
        ],
        ideas: [
          {
            title: "I",
            effort: "XL",
            inspired_by: { url: "sans titre" },
            has_prompt: "oui",
          },
          null,
        ],
        errors: ["e", 4],
      },
      weather: { text: "" },
      categories: [{ slug: "ia" }, { label: "sans slug" }, 3],
      missed: [{ slot_at: "nope" }, { slot_at: AT_13, status: "failed" }],
      days: ["2026-11-16", "../x", 5],
      last_success_at: 12,
    });
    expect(parsed).toEqual({
      run: {
        id: 0,
        schema: 1,
        day: "",
        slot_at: null,
        started_at: "",
        finished_at: AT_13,
        status: "done",
        model: "",
        items: [
          {
            id: null,
            title: "T",
            url: "",
            source: "",
            lang: "",
            category: "",
            sentence: "",
            summary: "",
            published_at: null,
            vote: null,
          },
        ],
        ideas: [
          {
            id: null,
            title: "I",
            benefit: "",
            effort: "M",
            first_step: "",
            inspired_by: null,
            vote: null,
            has_prompt: false,
          },
        ],
        errors: ["e"],
        manual: false,
      },
      weather: null,
      categories: [{ slug: "ia", label: "ia" }],
      last_success_at: null,
      missed: [{ slot_at: AT_13, status: "failed" }],
      days: ["2026-11-16"],
    });
  });

  test("test_parseRun_schema_annonce_ou_deduit", () => {
    const base = { finished_at: AT_13, items: [], ideas: [] };
    expect(parseRun({ ...base, schema: 1 })?.schema).toBe(1);
    expect(parseRun(base)?.schema).toBe(2);
    expect(
      parseRun({ ...base, items: [{ title: "Sans identifiant" }] })?.schema,
    ).toBe(1);
    expect(
      parseRun({
        ...base,
        items: [{ title: "Avec", id: "00000000000000aa" }],
      })?.schema,
    ).toBe(2);
  });

  test("test_parseRun_sans_heure_refuse", () => {
    expect(parseRun({ id: 1 })).toBeNull();
    expect(parseRun([])).toBeNull();
  });

  test("test_parseWeather_ancienne_forme_texte_seul", () => {
    const weather = parseWeather({
      day: "2026-11-16",
      text: "Le Pellerin : 6 à 12 °C",
      fetched_at: AT_13,
    });
    expect(weather).toEqual({
      day: "2026-11-16",
      label: "",
      text: "Le Pellerin : 6 à 12 °C",
      fetched_at: AT_13,
      condition: null,
      current: null,
      today: null,
      hours: [],
    });
  });

  test("test_parseWeather_valeurs_douteuses", () => {
    const weather = parseWeather({
      text: "x",
      condition: { key: "tornade", is_day: false },
      current: { temperature: "chaud", wind: Number.NaN },
      hours: [
        { at: "nope" },
        { at: AT_13, key: "snow", temperature: -2, is_day: false },
      ],
    });
    expect(weather?.condition).toEqual({
      code: -1,
      key: "unknown",
      label: "",
      is_day: false,
    });
    expect(weather?.current).toEqual({ temperature: null, wind: null });
    expect(weather?.hours).toEqual([
      {
        at: AT_13,
        temperature: -2,
        code: null,
        key: "snow",
        rain: null,
        is_day: false,
      },
    ]);
  });

  test("test_parseDay", () => {
    const day = parseDay({
      weather: latestFixture.weather,
      runs: [latestFixture.run, { id: 9 }],
      missed: "x",
      categories: latestFixture.categories,
    });
    expect(day?.runs).toHaveLength(1);
    expect(day?.missed).toEqual([]);
    expect(day?.weather?.day).toBe("2026-11-16");
    expect(day?.categories).toHaveLength(6);
    expect(parseDay([])).toBeNull();
    expect(parseDay({ runs: "x" })).toBeNull();
  });
});

describe("catégories et sources", () => {
  test("test_categoriesOf_ordre_du_routeur_puis_inconnues", () => {
    const { run, categories } = latest();
    const present = categoriesOf(
      [...run.items, item({ category: "quantique" })],
      categories,
    );
    expect(present.map((c) => c.slug)).toEqual([
      "ia",
      "cloud",
      "dev",
      "securite",
      "materiel",
      "informatique",
      "quantique",
    ]);
    expect(present[0]).toEqual({ slug: "ia", label: "IA", count: 5 });
    expect(present.at(-1)?.label).toBe("quantique");
  });

  test("test_categoryLabel_et_couleur", () => {
    const { categories } = latest();
    expect(categoryLabel("dev", categories)).toBe("Dev & outils");
    expect(categoryLabel("x", categories)).toBe("x");
    expect(categoryLabel("", [])).toBe("Autre");
    expect(categoryColor("securite")).toBe("securite");
    expect(categoryColor("x")).toBe("autre");
    expect(categoryColor("")).toBe("autre");
  });

  test("test_sourcesOf_uniques_triees", () => {
    expect(
      sourcesOf([
        item({ source: "Zdnet" }),
        item({ source: "ActuIA" }),
        item({ source: "zdnet" }),
        item({ source: "Zdnet" }),
        item({ source: "" }),
      ]),
    ).toEqual(["ActuIA", "Zdnet", "zdnet"]);
  });

  test("test_sourceInitials", () => {
    expect(sourceInitials("The Verge IA")).toBe("TV");
    expect(sourceInitials("BleepingComputer")).toBe("BL");
    expect(sourceInitials("Tom's Hardware")).toBe("TS");
    expect(sourceInitials("01net")).toBe("01");
    expect(sourceInitials("")).toBe("?");
  });
});

describe("filtres", () => {
  const items = [
    item({
      id: "a",
      title: "Sécurité des modèles",
      category: "securite",
      source: "Next",
      lang: "fr",
    }),
    item({
      id: "b",
      title: "Kubernetes GPU",
      category: "cloud",
      source: "Kubernetes",
      vote: "like",
    }),
    item({
      id: "c",
      title: "Nouveau modèle vocal",
      sentence: "À comparer à Parakeet.",
      category: "ia",
      source: "ActuIA",
      lang: "fr",
    }),
  ];
  const ids = (list: VeilleItem[]) => list.map((i) => i.id);

  test("test_sans_filtre_tout_passe", () => {
    expect(filterItems(items, NO_FILTERS)).toHaveLength(3);
    expect(activeFilters(NO_FILTERS)).toBe(0);
  });

  test("test_filtre_categories_multiples", () => {
    expect(
      ids(filterItems(items, { ...NO_FILTERS, categories: ["ia", "cloud"] })),
    ).toEqual(["b", "c"]);
  });

  test("test_filtre_source_langue_aimes", () => {
    expect(ids(filterItems(items, { ...NO_FILTERS, source: "Next" }))).toEqual([
      "a",
    ]);
    expect(ids(filterItems(items, { ...NO_FILTERS, lang: "fr" }))).toEqual([
      "a",
      "c",
    ]);
    expect(ids(filterItems(items, { ...NO_FILTERS, likedOnly: true }))).toEqual(
      ["b"],
    );
  });

  test("test_aimes_selon_vote_local", () => {
    const local = (i: VeilleItem) => (i.id === "c" ? "like" : null);
    expect(
      ids(filterItems(items, { ...NO_FILTERS, likedOnly: true }, local)),
    ).toEqual(["c"]);
  });

  test("test_recherche_casse_et_accents_ignores", () => {
    expect(
      ids(filterItems(items, { ...NO_FILTERS, query: "SECURITE" })),
    ).toEqual(["a"]);
    expect(
      ids(filterItems(items, { ...NO_FILTERS, query: "parakeet" })),
    ).toEqual(["c"]);
    expect(
      ids(filterItems(items, { ...NO_FILTERS, query: "actuia vocal" })),
    ).toEqual(["c"]);
    expect(ids(filterItems(items, { ...NO_FILTERS, query: "  " }))).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(fold("Été À Noël")).toBe("ete a noel");
  });

  test("test_filtres_combines_en_et", () => {
    const filters = {
      categories: ["ia", "securite"],
      source: "",
      lang: "fr" as const,
      likedOnly: false,
      query: "modele",
    };
    expect(ids(filterItems(items, filters))).toEqual(["a", "c"]);
    expect(activeFilters(filters)).toBe(3);
    expect(
      filterItems(items, { ...filters, source: "Kubernetes" }),
    ).toHaveLength(0);
  });

  test("test_compteur", () => {
    expect(countLabel(12, 20)).toBe("12 articles sur 20");
    expect(countLabel(1, 20)).toBe("1 article sur 20");
    expect(countLabel(0, 20)).toBe("0 article sur 20");
    expect(countLabel(20, 20)).toBe("20 articles");
    expect(countLabel(1, 1)).toBe("1 article");
  });
});

describe("votes", () => {
  test("test_second_clic_annule", () => {
    expect(nextVote(null, "like")).toBe("like");
    expect(nextVote("like", "like")).toBe("none");
    expect(nextVote("dislike", "like")).toBe("like");
    expect(nextVote("like", "dislike")).toBe("dislike");
    expect(nextVote("dislike", "dislike")).toBe("none");
  });

  test("test_cle_locale_par_type", () => {
    expect(voteKey("article", "abc")).toBe("article:abc");
    expect(voteKey("idea", "abc")).not.toBe(voteKey("article", "abc"));
  });
});

describe("météo", () => {
  test.each<[VeilleWeatherKey, boolean, string]>([
    ["clear", true, "clear-day"],
    ["clear", false, "clear-night"],
    ["partly-cloudy", true, "partly-cloudy-day"],
    ["partly-cloudy", false, "partly-cloudy-night"],
    ["cloudy", false, "cloudy"],
    ["fog", true, "fog"],
    ["drizzle", true, "drizzle"],
    ["rain", true, "rain"],
    ["rain", false, "rain"],
    ["snow", true, "snow"],
    ["storm", true, "storm"],
    ["unknown", true, "unknown"],
  ])("test_weatherArt_%s_jour_%s", (key, isDay, art) => {
    expect(weatherArt(key, isDay)).toBe(art);
  });

  test("test_code_61_de_jour_dessine_la_pluie", () => {
    const { weather } = latest();
    const condition = weather?.condition;
    expect(condition && weatherArt(condition.key, condition.is_day)).toBe(
      "rain",
    );
  });

  test("test_weatherKey_inconnue", () => {
    expect(weatherKey("rain")).toBe("rain");
    expect(weatherKey("grêle")).toBe("unknown");
    expect(weatherKey(undefined)).toBe("unknown");
  });

  test("test_libelles_et_degres", () => {
    expect(weatherLabel("clear")).toBe("Ensoleillé");
    expect(weatherLabel("clear", false)).toBe("Ciel dégagé");
    expect(weatherLabel("storm", false)).toBe("Orage");
    expect(degrees(10.6)).toBe("11 °C");
    expect(degrees(-0.2)).toBe("0 °C");
    expect(degrees(null)).toBe("–");
  });
});

describe("copie", () => {
  function fakeDoc(copyResult: boolean | "throw") {
    const appended: { value: string; readOnly: boolean; removed: boolean }[] =
      [];
    const doc = {
      body: {
        appendChild(area: (typeof appended)[number]) {
          appended.push(area);
        },
      },
      createElement() {
        const area = {
          value: "",
          readOnly: false,
          className: "",
          removed: false,
          select: vi.fn(),
          remove() {
            area.removed = true;
          },
        };
        return area;
      },
      execCommand: vi.fn(() => {
        if (copyResult === "throw") throw new Error("refus");
        return copyResult;
      }),
    };
    return { doc: doc as unknown as Document, appended, raw: doc };
  }

  test("test_presse_papiers", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    expect(await copyText("prompt", { clipboard: { writeText } })).toBe(
      "clipboard",
    );
    expect(writeText).toHaveBeenCalledWith("prompt");
  });

  test("test_repli_zone_de_texte_selectionnee", async () => {
    const writeText = vi.fn(() => Promise.reject(new Error("refus")));
    const { doc, appended, raw } = fakeDoc(true);
    expect(await copyText("prompt", { clipboard: { writeText }, doc })).toBe(
      "fallback",
    );
    expect(raw.execCommand).toHaveBeenCalledWith("copy");
    expect(appended[0]).toMatchObject({
      value: "prompt",
      readOnly: true,
      removed: true,
    });
  });

  test("test_repli_dans_le_conteneur_donne", async () => {
    const { doc } = fakeDoc(true);
    const inside: unknown[] = [];
    const container = {
      appendChild: (node: unknown) => inside.push(node),
    } as unknown as HTMLElement;
    expect(await copyText("p", { doc, container })).toBe("fallback");
    expect(inside).toHaveLength(1);
  });

  test("test_copie_impossible_manuelle", async () => {
    expect(await copyText("p", {})).toBe("manual");
    expect(await copyText("p", { doc: fakeDoc(false).doc })).toBe("manual");
    const failing = fakeDoc("throw");
    expect(await copyText("p", { doc: failing.doc })).toBe("manual");
    expect(failing.appended[0]?.removed).toBe(true);
  });
});

describe("heures", () => {
  test("test_heures_hiver_et_ete_en_heure_de_paris", () => {
    expect(formatTime("2026-11-16T12:00:00+00:00")).toBe("13:00");
    expect(formatTime("2026-07-01T06:00:00+00:00")).toBe("08:00");
    expect(formatTime("2026-03-29T06:00:00+00:00")).toBe("08:00");
    expect(formatTime("2026-10-25T07:00:00+00:00")).toBe("08:00");
    expect(formatTime("n'importe quoi")).toBe("");
  });

  test("test_heure_de_la_frise", () => {
    expect(formatHour("2026-11-16T13:00:00+01:00")).toBe("13 h");
    expect(formatHour("2026-11-17T00:00:00+01:00")).toBe("00 h");
    expect(formatHour("")).toBe("");
  });

  test("test_date_et_heure", () => {
    expect(formatDateTime("2026-11-16T12:00:00+00:00")).toMatch(
      /lun\.? 16 nov\.?,? 13:00/,
    );
    expect(formatDateTime("")).toBe("");
  });

  test("test_jour", () => {
    expect(formatDay("2026-11-16")).toBe("lundi 16 novembre 2026");
    expect(formatDay("pas un jour")).toBe("pas un jour");
  });

  test("test_heure_relative", () => {
    const now = new Date("2026-11-16T12:00:00Z");
    expect(relativeTime("2026-11-16T11:59:40Z", now)).toBe("à l'instant");
    expect(relativeTime("2026-11-16T11:35:00Z", now)).toBe("il y a 25 min");
    expect(relativeTime("2026-11-16T09:00:00Z", now)).toBe("il y a 3 h");
    expect(relativeTime("2026-11-15T09:00:00Z", now)).toBe("hier");
    expect(relativeTime("2026-11-13T09:00:00Z", now)).toMatch(/13 nov/);
    expect(relativeTime(null, now)).toBe("");
  });
});

describe("appels du routeur", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function reply(status: number, json: unknown) {
    return Promise.resolve(
      new Response(JSON.stringify(json), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  test("test_vote_envoye", async () => {
    const fetch = vi.fn((_url: string, _init?: RequestInit) =>
      reply(200, { kind: "article", id: "a", value: "like", voted_at: AT_13 }),
    );
    vi.stubGlobal("fetch", fetch);
    expect((await sendVote("article", "a", "like")).voted_at).toBe(AT_13);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("api/veille/vote");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      kind: "article",
      id: "a",
      value: "like",
    });
  });

  test("test_vote_refuse_message_et_statut", async () => {
    vi.stubGlobal("fetch", () => reply(404, { detail: "Article inconnu" }));
    const error = await sendVote("article", "a", "like").catch((e) => e);
    expect(error).toBeInstanceOf(VeilleApiError);
    expect(error.message).toBe("Article inconnu");
    expect(error.status).toBe(404);
    expect(retryable(error)).toBe(false);
  });

  test("test_serveur_injoignable_reessayable", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("réseau")));
    const error = await sendVote("idea", "a", "none").catch((e) => e);
    expect(error.status).toBe(0);
    expect(retryable(error)).toBe(true);
    expect(retryable(new VeilleApiError("x", 503))).toBe(true);
    expect(retryable(new VeilleApiError("x", 409))).toBe(false);
    expect(retryable(new Error("x"))).toBe(true);
  });

  test("test_prompt_connu_relu_sinon_fabrique", async () => {
    const prompt = {
      idea_id: "a",
      prompt: "# Contexte",
      model: "m",
      created_at: AT_13,
      cached: true,
    };
    const fetch = vi.fn((_url: string, init?: RequestInit) =>
      init?.method === "GET" ? reply(404, {}) : reply(200, prompt),
    );
    vi.stubGlobal("fetch", fetch);
    expect((await loadIdeaPrompt("a", true)).prompt).toBe("# Contexte");
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual([
      "GET",
      "POST",
    ]);
    fetch.mockClear();
    await loadIdeaPrompt("a", false);
    expect(fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["api/veille/idea/a/prompt", "POST"],
    ]);
  });

  test("test_prompt_erreurs", async () => {
    vi.stubGlobal("fetch", () => reply(503, { detail: "Aucun modèle" }));
    const error = await loadIdeaPrompt("a", true).catch((e) => e);
    expect(error.status).toBe(503);
    expect(error.message).toBe("Aucun modèle");
    vi.stubGlobal("fetch", () => reply(200, { prompt: "" }));
    const empty = await loadIdeaPrompt("a", false).catch((e) => e);
    expect(empty.status).toBe(502);
    vi.stubGlobal("fetch", () => reply(500, "pas du json"));
    const raw = await loadIdeaPrompt("a", false).catch((e) => e);
    expect(raw.message).toBe("erreur HTTP 500");
  });
});

describe("sources", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function reply(status: number, json: unknown) {
    return Promise.resolve(
      new Response(JSON.stringify(json), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  test("test_adresse_affichee", () => {
    expect(sourceHost("https://www.korben.info/feed")).toBe("korben.info");
    expect(sourceHost("https://blog.python.org/rss.xml")).toBe(
      "blog.python.org",
    );
    expect(sourceHost("pas une adresse")).toBe("");
  });

  test("test_formulaire_pret", () => {
    expect(sourceReady(EMPTY_SOURCE)).toBe(false);
    expect(
      sourceReady({ ...EMPTY_SOURCE, url: "https://blog.exemple.com" }),
    ).toBe(true);
    expect(sourceReady({ ...EMPTY_SOURCE, url: "blog.exemple.com" })).toBe(
      false,
    );
    expect(sourceReady({ ...EMPTY_SOURCE, url: "https://localhost" })).toBe(
      false,
    );
    const search = { ...EMPTY_SOURCE, kind: "search" as const };
    expect(sourceReady({ ...search, query: " a " })).toBe(false);
    expect(sourceReady({ ...search, query: "Rust" })).toBe(true);
  });

  test("test_resume_de_l_essai", () => {
    const probe = { name: "x", url: "u", latest: [] };
    expect(probeSummary({ ...probe, articles: 12, recent: 4 })).toBe(
      "12 articles, dont 4 de moins de 48 h",
    );
    expect(probeSummary({ ...probe, articles: 1, recent: 0 })).toBe(
      "1 article, dont 0 de moins de 48 h",
    );
  });

  test("test_recherche_des_sources", () => {
    const list = [
      {
        name: "Le Monde Informatique",
        url: "https://www.lemondeinformatique.fr/rss",
      },
      { name: "Korben", url: "https://korben.info/feed" },
    ];
    expect(filterSources(list, "").length).toBe(2);
    expect(filterSources(list, "MONDE info").map((s) => s.name)).toEqual([
      "Le Monde Informatique",
    ]);
    expect(filterSources(list, "korben.info").map((s) => s.name)).toEqual([
      "Korben",
    ]);
    expect(filterSources(list, "absent")).toEqual([]);
  });

  test("test_appels_des_sources", async () => {
    const fetch = vi.fn((_url: string, init?: RequestInit) =>
      init?.method === "DELETE"
        ? Promise.resolve(new Response(null, { status: 204 }))
        : reply(200, { ok: true }),
    );
    vi.stubGlobal("fetch", fetch);
    const input = { ...EMPTY_SOURCE, url: "https://blog.exemple.com" };
    await loadSources();
    await testSource(input);
    await addSource(input);
    await updateSource(3, { category: "ia" });
    expect(await deleteSource(3)).toBeUndefined();
    await setBuiltinEnabled("Korben", false);
    expect(
      fetch.mock.calls.map(([url, init]) => [
        url,
        init?.method,
        init?.body ? JSON.parse(String(init.body)) : null,
      ]),
    ).toEqual([
      ["api/veille/sources", "GET", null],
      ["api/veille/sources/test", "POST", input],
      ["api/veille/sources", "POST", input],
      ["api/veille/sources/3", "PATCH", { category: "ia" }],
      ["api/veille/sources/3", "DELETE", null],
      [
        "api/veille/sources/builtin",
        "POST",
        { name: "Korben", enabled: false },
      ],
    ]);
  });

  test("test_essai_refuse", async () => {
    vi.stubGlobal("fetch", () =>
      reply(422, {
        detail: "Adresse refusée : https et site public seulement",
      }),
    );
    const error = await testSource(EMPTY_SOURCE).catch((e) => e);
    expect(error).toBeInstanceOf(VeilleApiError);
    expect(error.status).toBe(422);
    expect(retryable(error)).toBe(false);
    expect(error.message).toContain("Adresse refusée");
  });
});

describe("journée, tous les articles, passage manuel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function reply(status: number, json: unknown) {
    return Promise.resolve(
      new Response(JSON.stringify(json), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  function run(changes: Partial<VeilleRun>): VeilleRun {
    return {
      id: 1,
      schema: 2,
      day: "2026-11-16",
      slot_at: null,
      started_at: "2026-11-16T07:00:00+00:00",
      finished_at: "2026-11-16T07:01:00+00:00",
      status: "done",
      model: "m",
      items: [],
      ideas: [],
      errors: [],
      manual: false,
      ...changes,
    };
  }

  function other(changes: Partial<VeilleOther>): VeilleOther {
    return { ...item({}), id: "a000000000000009", score: 0, ...changes };
  }

  const A = "a000000000000001";
  const B = "a000000000000002";
  const C = "a000000000000003";

  test("test_passages_fusionnes_le_plus_recent_d_abord_sans_doublon", () => {
    const morning = run({
      id: 1,
      items: [item({ id: A, title: "A matin" }), item({ id: B })],
      ideas: [
        {
          id: C,
          title: "Idée",
          benefit: "",
          effort: "S",
          first_step: "",
          inspired_by: null,
          vote: null,
          has_prompt: false,
        },
      ],
    });
    const noon = run({
      id: 2,
      finished_at: "2026-11-16T12:01:00+00:00",
      items: [item({ id: A, title: "A midi" }), item({ id: null })],
      manual: true,
    });
    const entries = dayItems([morning, noon]);
    expect(entries.map((e) => [e.value.id, e.runFinishedAt])).toEqual([
      [A, noon.finished_at],
      [null, noon.finished_at],
      [B, morning.finished_at],
    ]);
    expect(entries[0]?.value.title).toBe("A midi");
    expect(dayIdeas([morning, noon]).map((e) => e.value.id)).toEqual([C]);
    expect(lastRun([morning, noon])?.id).toBe(2);
    // Même heure : le plus grand identifiant
    expect(lastRun([noon, { ...noon, id: 3 }])?.id).toBe(3);
    expect(lastRun([])).toBeUndefined();
  });

  test("test_libelle_des_passages", () => {
    expect(runsLabel([])).toBe("Aucun passage ce jour");
    expect(runsLabel([run({})])).toBe("1 passage · dernier à 08:01");
    expect(
      runsLabel([
        run({}),
        run({
          id: 2,
          finished_at: "2026-11-16T12:01:00+00:00",
          status: "failed",
        }),
      ]),
    ).toBe("2 passages · dernier à 13:01 (en échec)");
  });

  test("test_lecture_des_articles_non_retenus", () => {
    expect(parseOthers(null)).toBeNull();
    expect(parseOthers({ items: "x" })).toBeNull();
    const parsed = parseOthers({
      day: "2026-11-16",
      items: [
        { id: A, title: "Un", summary: "Extrait", score: 1.5 },
        { id: B, title: "Deux", score: "haut" },
        { id: null, title: "Sans identifiant" },
        { id: C },
        "texte",
      ],
    });
    expect(parsed?.day).toBe("2026-11-16");
    expect(parsed?.items.map((i) => [i.id, i.score, i.summary])).toEqual([
      [A, 1.5, "Extrait"],
      [B, 0, ""],
    ]);
  });

  test("test_tri_pertinence_ou_date", () => {
    const older = other({
      id: A,
      score: 2,
      published_at: "2026-11-16T06:00:00+00:00",
    });
    const newer = other({
      id: B,
      score: 1,
      published_at: "2026-11-16T09:00:00+00:00",
    });
    const tie = other({ id: C, score: 1, published_at: null });
    expect(sortOthers([newer, tie, older], "score").map((i) => i.id)).toEqual([
      A,
      B,
      C,
    ]);
    expect(sortOthers([older, tie, newer], "date").map((i) => i.id)).toEqual([
      B,
      A,
      C,
    ]);
    const sameDate = other({
      id: C,
      score: 5,
      published_at: newer.published_at,
    });
    expect(sortOthers([newer, sameDate], "date").map((i) => i.id)).toEqual([
      C,
      B,
    ]);
  });

  test("test_recherche_dans_l_extrait", () => {
    const items = [item({ summary: "Un extrait sur Kubernetes" }), item({})];
    expect(filterItems(items, { ...NO_FILTERS, query: "kubernetes" })).toEqual([
      items[0],
    ]);
  });

  test("test_etat_du_passage_manuel", () => {
    expect(parseRunStatus(null)).toBeNull();
    expect(parseRunStatus({ state: "inconnu" })).toBeNull();
    expect(
      parseRunStatus({
        state: "running",
        request_id: 3,
        requested_at: AT_13,
        retry_after: -4,
      }),
    ).toEqual({
      state: "running",
      request_id: 3,
      requested_at: AT_13,
      started_at: null,
      finished_at: null,
      run_id: null,
      retry_after: 0,
    });
    const status = parseRunStatus({ state: "pending", retry_after: 120 });
    expect(runBusy(status)).toBe(true);
    expect(runBusy({ ...status!, state: "running" })).toBe(true);
    expect(runBusy({ ...status!, state: "done" })).toBe(false);
    expect(runBusy(null)).toBe(false);
  });

  test("test_message_de_fin", () => {
    expect(runOutcome("done", 3)).toBe(
      "Nouveau passage terminé : 3 articles ajoutés",
    );
    expect(runOutcome("done", 1)).toBe(
      "Nouveau passage terminé : 1 article ajouté",
    );
    expect(runOutcome("done", 0)).toBe(
      "Nouveau passage terminé : aucun article nouveau",
    );
    expect(runOutcome("failed", 0)).toContain("en échec");
    expect(runOutcome("expired", 0)).toContain("antares-tasks");
    expect(runOutcome("running", 0)).toBeNull();
  });

  test("test_appels_du_routeur", async () => {
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("api/veille/others"))
        return reply(200, {
          day: "2026-11-16",
          items: [{ id: A, title: "T" }],
        });
      if (url === "api/veille/run")
        return init?.method === "POST"
          ? reply(202, { state: "pending", request_id: 1, retry_after: 300 })
          : reply(200, { state: "idle" });
      if (url.endsWith("/favorites"))
        return reply(200, { names: ["Korben"], max_favorites: 10 });
      return reply(200, JSON.parse(String(init?.body)));
    });
    vi.stubGlobal("fetch", fetch);
    expect((await loadOthers("2026-11-16")).items[0]?.id).toBe(A);
    expect(fetch.mock.calls[0]?.[0]).toBe("api/veille/others?date=2026-11-16");
    expect((await loadRunStatus()).state).toBe("idle");
    expect((await requestRun()).state).toBe("pending");
    expect(fetch.mock.calls[2]?.[1]?.method).toBe("POST");
    expect((await loadFavorites()).names).toEqual(["Korben"]);
    expect(await setFavorite("Korben", false)).toEqual({
      name: "Korben",
      favorite: false,
    });
    expect(fetch.mock.calls[4]?.[0]).toBe("api/veille/sources/favorite");
  });

  test("test_traduction_un_seul_appel", async () => {
    const done = {
      article_id: A,
      title: "Titre",
      model: "m",
      created_at: AT_13,
      cached: false,
    };
    const fetch = vi.fn((_url: string, _init?: RequestInit) =>
      reply(200, done),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await translateArticle(A)).toEqual({ ...done, summary: "" });
    expect(fetch.mock.calls.map((c) => [c[0], c[1]?.method])).toEqual([
      [`api/veille/article/${A}/translate`, "POST"],
    ]);
    vi.stubGlobal("fetch", () => reply(200, { ...done, summary: "S" }));
    expect((await translateArticle(A)).summary).toBe("S");
    vi.stubGlobal("fetch", () => reply(200, { title: "" }));
    await expect(translateArticle(A)).rejects.toThrow("illisible");
    vi.stubGlobal("fetch", () => reply(503, { detail: "Modèle injoignable" }));
    await expect(translateArticle(A)).rejects.toMatchObject({ status: 503 });
  });

  test("test_reponses_illisibles_et_refus", async () => {
    vi.stubGlobal("fetch", () => reply(200, { items: "x" }));
    await expect(loadOthers("2026-11-16")).rejects.toThrow("illisible");
    vi.stubGlobal("fetch", () => reply(200, { state: "?" }));
    await expect(loadRunStatus()).rejects.toThrow("illisible");
    vi.stubGlobal("fetch", () =>
      reply(429, { detail: "Prochain passage manuel possible dans 4 min" }),
    );
    await expect(requestRun()).rejects.toMatchObject({
      status: 429,
      message: "Prochain passage manuel possible dans 4 min",
    });
  });
});
