// Présidentielle 2027, lot 1 (P27-U-01 à P27-U-08) : tirage au sort de l'ordre des
// candidats (Fisher-Yates, générateur injectable, crypto.getRandomValues en production)
// et ordre de la visite partagé. Propriétés vérifiées par boucles à graine fixe.
// Lot 3 (P27-U-20 à P27-U-51) : proximité, barres à deux pôles, ordre des options et
// mémoire du quiz dans le navigateur. Lot 4b (P27-U-60 à P27-U-62) : nouveautés de la
// surveillance, lues pour le propriétaire seulement ; positions des votes réels.
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  cryptoRng,
  indexBelow,
  shuffle,
  type Rng,
} from "@/features/presidentielle/shuffle";
import {
  askBody,
  postAsk,
  RETRY_MS,
  startAsk,
  type AskOutcome,
} from "@/features/presidentielle/assistant";
import { checkedNouveautes, checkedQuiz } from "@/features/presidentielle/api";
import {
  formatDate,
  POSITION_LABEL,
  safeUrl,
  themeLabel,
} from "@/features/presidentielle/labels";
import {
  poleCounts,
  polesVisible,
  poleText,
} from "@/features/presidentielle/poles";
import {
  AUCUNE,
  counted,
  proximity,
  reportCandidates,
  SANS_AVIS,
  score,
  scoreText,
  sortByProximity,
  type Score,
} from "@/features/presidentielle/proximity";
import {
  browserStorage,
  clearSave,
  newSave,
  optionOrder,
  QUIZ_KEY,
  quizQuestions,
  readSave,
  resumeSave,
  writeSave,
  type QuizSave,
  type StorageLike,
} from "@/features/presidentielle/quizStorage";
import {
  inVisitOrder,
  loadSignalements,
  presidentielleStore,
  visitOrder,
} from "@/features/presidentielle/state";
import type {
  AskAnswer,
  AskBody,
  Candidat,
  Meta,
  Nouveautes,
  QuizData,
  QuizOption,
  QuizQuestion,
  QuizTheme,
  Rattachement,
  Theme,
} from "@/features/presidentielle/types";
import baseFixture from "../fixtures/api/presidentielle.json";
import quizFixture from "../fixtures/api/presidentielle_quiz.json";

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

  test("themeLabel : libellé servi, sinon liste des thèmes, sinon identifiant", () => {
    const themes = new Map([["sante", "Santé"]]);
    expect(themeLabel({ theme: "sante", theme_libelle: "Soins" }, themes)).toBe(
      "Soins",
    );
    expect(themeLabel({ theme: "sante" }, themes)).toBe("Santé");
    expect(themeLabel({ theme: "numerique" }, themes)).toBe("numerique");
  });

  test("P27-U-76 : thèmes des fiches hors quiz, libellés servis, absents du quiz", () => {
    // Sortie du routeur sur le jeu fictif : 10 thèmes de la grille, puis les 2 hors
    // quiz (sans axe) ; le quiz n'en connaît aucun, le rapport non plus
    const servis = baseFixture.themes as Theme[];
    expect(servis.map((t) => t.id).slice(-2)).toEqual([
      "culture",
      "solidarites",
    ]);
    expect(servis.filter((t) => t.hors_quiz).map((t) => t.axe)).toEqual([
      null,
      null,
    ]);
    expect(servis.filter((t) => !t.hors_quiz)).toHaveLength(10);
    const labels = new Map(servis.map((t) => [t.id, t.libelle]));
    expect(themeLabel({ theme: "culture" }, labels)).toBe(
      "Culture, sport et vie associative",
    );
    expect(themeLabel({ theme: "solidarites" }, labels)).toBe(
      "Famille et solidarités",
    );
    const quiz = checkedQuiz(quizFixture as unknown as QuizData);
    const horsQuiz = new Set(["culture", "solidarites"]);
    expect(quiz.themes.some((t) => horsQuiz.has(t.id))).toBe(false);
    expect(
      quizQuestions(quiz).some((q) => horsQuiz.has(q.id.split("-")[0] ?? "")),
    ).toBe(false);
    const counts = poleCounts(
      quiz.themes,
      quizQuestions(quiz).map((q) => q.id),
      {},
    );
    expect(counts.some((c) => horsQuiz.has(c.theme.id))).toBe(false);
  });
});

// Assistant (lot 2, P27-U-10 à P27-U-12) : mise en attente pendant un appel vocal,
// annulation en quittant la page, corps limité à la question, l'ordre et la mention
const ANSWER: AskAnswer = {
  kind: "recherche",
  introduction: "Voici les passages relus qui portent sur votre question.",
  theme: null,
  ordre: ["b", "a"],
  passages: [],
  sans_position: [],
  model: "ollama/gemma4:e4b",
  moteur: "mots",
  base_version: "abc",
};

function scripted(outcomes: AskOutcome[]) {
  const bodies: AskBody[] = [];
  const send = vi.fn(async (body: AskBody) => {
    bodies.push(body);
    return outcomes.shift() ?? { status: "answer" as const, answer: ANSWER };
  });
  return { send, bodies };
}

describe("assistant (assistant.ts)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("P27-U-10 : question gardée pendant un appel, renvoyée toutes les 30 s, une fois à la fin", async () => {
    vi.useFakeTimers();
    const { send, bodies } = scripted([
      { status: "waiting" },
      { status: "waiting" },
    ]);
    let callActive = true;
    const updates: string[] = [];
    startAsk({
      body: () => askBody(" Que proposent-ils ? ", ["b", "a"], callActive),
      onUpdate: (outcome) => updates.push(outcome.status),
      send,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(updates).toEqual(["waiting"]);
    await vi.advanceTimersByTimeAsync(RETRY_MS - 1);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    callActive = false;
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(send).toHaveBeenCalledTimes(3);
    expect(updates).toEqual(["waiting", "waiting", "answer"]);
    // Réponse reçue : plus aucun envoi
    await vi.advanceTimersByTimeAsync(RETRY_MS * 5);
    expect(send).toHaveBeenCalledTimes(3);
    expect(bodies.map((b) => b.appel_en_cours)).toEqual([true, true, false]);
    expect(new Set(bodies.map((b) => b.question))).toEqual(
      new Set(["Que proposent-ils ?"]),
    );
  });

  test("P27-U-11 : quitter la page annule la minuterie et la requête", async () => {
    vi.useFakeTimers();
    const { send } = scripted([{ status: "waiting" }]);
    const updates: string[] = [];
    const cancel = startAsk({
      body: () => askBody("Question", ["a"], true),
      onUpdate: (outcome) => updates.push(outcome.status),
      send,
    });
    await vi.advanceTimersByTimeAsync(0);
    cancel();
    await vi.advanceTimersByTimeAsync(RETRY_MS * 3);
    expect(send).toHaveBeenCalledTimes(1);
    expect(updates).toEqual(["waiting"]);

    // Annulation pendant la requête : signal levé, aucune mise à jour
    let signal: AbortSignal | undefined;
    const pending = vi.fn(
      (_body: AskBody, s: AbortSignal) =>
        new Promise<AskOutcome>((_resolve, reject) => {
          signal = s;
          s.addEventListener("abort", () => reject(new Error("abort")));
        }),
    );
    const late: string[] = [];
    const stop = startAsk({
      body: () => askBody("Question", ["a"], false),
      onUpdate: (outcome) => late.push(outcome.status),
      send: pending,
    });
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(signal?.aborted).toBe(true);
    expect(late).toEqual([]);
  });

  test("P27-U-12 : corps limité à question, ordre et mention d'appel", async () => {
    const body = askBody("  Et la santé ?  ", ["c", "a", "b"], false);
    expect(Object.keys(body).sort()).toEqual([
      "appel_en_cours",
      "ordre",
      "question",
    ]);
    expect(body).toEqual({
      question: "Et la santé ?",
      ordre: ["c", "a", "b"],
      appel_en_cours: false,
    });
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify(ANSWER), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await postAsk(body)).toEqual({ status: "answer", answer: ANSWER });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("api/presidentielle/ask");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "X-Antares": "1" });
    expect(JSON.parse(String(init.body))).toEqual(body);
  });

  test("postAsk : 409 en attente, erreurs lisibles, serveur injoignable", async () => {
    const reply = (status: number, json: unknown) =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify(json), { status })),
      );
    const body = askBody("Q", [], false);
    reply(409, { kind: "attente", retry_after: 30 });
    expect(await postAsk(body)).toEqual({ status: "waiting" });
    reply(503, { detail: "modèle non autorisé pour cette page" });
    expect(await postAsk(body)).toEqual({
      status: "error",
      message: "modèle non autorisé pour cette page",
    });
    reply(500, {});
    expect(await postAsk(body)).toEqual({
      status: "error",
      message: "erreur HTTP 500",
    });
    reply(200, { kind: "recherche" });
    expect(await postAsk(body)).toEqual({
      status: "error",
      message: "réponse du routeur illisible",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("réseau");
      }),
    );
    expect(await postAsk(body)).toEqual({
      status: "error",
      message: "le serveur est injoignable",
    });
  });

  test("startAsk : une panne d'envoi devient une erreur affichable", async () => {
    const updates: AskOutcome[] = [];
    startAsk({
      body: () => askBody("Q", [], false),
      onUpdate: (outcome) => updates.push(outcome),
      send: async () => {
        throw new Error("panne");
      },
    });
    await vi.waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toEqual({
      status: "error",
      message: "le serveur est injoignable",
    });
  });
});

// --- Lot 3 : quiz -------------------------------------------------------------------

// Grille de test : q01 à q20 ; options <q>-x, <q>-y, <q>-z, puis « aucune », « sans avis »
const Q = Array.from(
  { length: 20 },
  (_, i) => `q${String(i + 1).padStart(2, "0")}`,
);
const opt = (q: string, k: "x" | "y" | "z") => `${q}-${k}`;
const link = (
  question: string,
  candidat: string,
  option: string,
): Rattachement => ({ question, candidat, option, mesure_id: "m" });

describe("proximité (proximity.ts)", () => {
  // Exemple 1 : q01 à q16 répondues (q15 : « aucune »), q17 et q18 « sans avis », q19 et
  // q20 sans réponse ; A a une position sur q01 à q15, q17, q18, q19 ; accord sur q01 à q09
  function example1() {
    const reponses: Record<string, string> = {};
    Q.slice(0, 16).forEach((q, i) => {
      reponses[q] = i < 9 ? opt(q, "x") : opt(q, "y");
    });
    reponses.q15 = AUCUNE;
    reponses.q17 = SANS_AVIS;
    reponses.q18 = SANS_AVIS;
    const liens = [
      ...Q.slice(0, 15).map((q) => link(q, "A", opt(q, "x"))),
      ...["q17", "q18", "q19"].map((q) => link(q, "A", opt(q, "x"))),
    ];
    return { reponses, liens };
  }

  test("P27-U-20 : exemple 1, 60 %, sur 15 questions", () => {
    const { reponses, liens } = example1();
    const result = proximity(Q, reponses, liens, ["A"]).get("A") as Score;
    expect(result).toEqual({
      insuffisant: false,
      pourcent: 60,
      n: 15,
      accords: 9,
    });
    expect(scoreText(result)).toBe("60 %, sur 15 questions");
  });

  test("P27-U-21 : exemple 2, données insuffisantes (6 questions), jamais 100 %", () => {
    const reponses = Object.fromEntries(Q.map((q) => [q, opt(q, "x")]));
    const liens = Q.slice(0, 6).map((q) => link(q, "B", opt(q, "x")));
    const result = proximity(Q, reponses, liens, ["B"]).get("B") as Score;
    expect(result).toEqual({ insuffisant: true, n: 6, accords: 6 });
    expect(scoreText(result)).toBe("données insuffisantes (6 questions)");
    expect(scoreText(result)).not.toContain("100");
  });

  test("P27-U-22 : exemple 3, « aucune » : désaccord pour A et C, B inchangé", () => {
    const reponses: Record<string, string> = Object.fromEntries(
      Q.map((q) => [q, opt(q, "x")]),
    );
    reponses.q16 = SANS_AVIS;
    const liens = [
      ...Q.map((q) => link(q, "A", opt(q, q === "q16" ? "y" : "x"))),
      ...Q.slice(0, 12).map((q) => link(q, "B", opt(q, "x"))),
      link("q16", "C", opt("q16", "z")),
      ...Q.slice(0, 11).map((q) => link(q, "C", opt(q, "y"))),
    ];
    const before = proximity(Q, reponses, liens, ["A", "B", "C"]);
    const after = proximity(Q, { ...reponses, q16: AUCUNE }, liens, [
      "A",
      "B",
      "C",
    ]);
    for (const id of ["A", "C"]) {
      expect(after.get(id)?.n).toBe((before.get(id)?.n ?? 0) + 1);
      expect(after.get(id)?.accords).toBe(before.get(id)?.accords);
    }
    expect(after.get("B")).toEqual(before.get("B"));
  });

  test("P27-U-23 : exemple 4, « sans avis » retire la question pour tous", () => {
    const reponses = Object.fromEntries(Q.map((q) => [q, opt(q, "x")]));
    const liens = ["A", "B", "C"].flatMap((c, k) =>
      Q.map((q, i) => link(q, c, opt(q, (i + k) % 3 ? "x" : "y"))),
    );
    const withSansAvis = proximity(Q, { ...reponses, q05: SANS_AVIS }, liens, [
      "A",
      "B",
      "C",
    ]);
    const without = proximity(
      Q.filter((q) => q !== "q05"),
      reponses,
      liens,
      ["A", "B", "C"],
    );
    expect(withSansAvis).toEqual(without);
  });

  test("règle 4 : une question laissée sans réponse compte comme « sans avis »", () => {
    const reponses = Object.fromEntries(Q.map((q) => [q, opt(q, "x")]));
    const liens = Q.map((q) => link(q, "A", opt(q, "x")));
    const { q07: _ignored, ...missing } = reponses;
    expect(proximity(Q, missing, liens, ["A"])).toEqual(
      proximity(Q, { ...reponses, q07: SANS_AVIS }, liens, ["A"]),
    );
    expect(counted(Q, missing)).toHaveLength(19);
  });

  test("rattachement en double : compté une fois", () => {
    const reponses = { q01: opt("q01", "x") };
    const liens = [
      link("q01", "A", opt("q01", "x")),
      link("q01", "A", opt("q01", "y")),
    ];
    expect(proximity(Q, reponses, liens, ["A"]).get("A")).toEqual({
      insuffisant: true,
      n: 1,
      accords: 1,
    });
  });

  test("P27-U-24 : seuil de 10 questions", () => {
    expect(score(9, 9)).toEqual({ insuffisant: true, n: 9, accords: 9 });
    expect(score(10, 10)).toEqual({
      insuffisant: false,
      pourcent: 100,
      n: 10,
      accords: 10,
    });
  });

  test("P27-U-25 : zéro accord sur 12 questions : 0 %, pas « insuffisant »", () => {
    const result = score(0, 12);
    expect(result).toMatchObject({ insuffisant: false, pourcent: 0 });
    expect(scoreText(result)).toBe("0 %, sur 12 questions");
  });

  test("P27-U-26 : aucune question : insuffisant, jamais NaN", () => {
    const result = proximity(Q, {}, [], ["A"]).get("A") as Score;
    expect(result).toEqual({ insuffisant: true, n: 0, accords: 0 });
    expect(scoreText(result)).toBe("données insuffisantes (0 question)");
    expect(scoreText(score(0, 1))).toBe("données insuffisantes (1 question)");
  });

  test("P27-U-27 : arrondi par Math.round", () => {
    const pct = (accords: number, n: number) => {
      const result = score(accords * 10, n * 10);
      return result.insuffisant ? null : result.pourcent;
    };
    expect([pct(2, 3), pct(1, 3), pct(5, 8), pct(1, 8)]).toEqual([
      67, 33, 63, 13,
    ]);
  });

  const candidat = (
    id: string,
    statut: Candidat["statut"],
    votes: Candidat["votes"] = [],
  ) => ({ id, statut, votes }) as Candidat;

  test("P27-U-28 : les votes réels ne changent rien", () => {
    const { reponses, liens } = example1();
    const sans = reportCandidates([candidat("A", "declare")], ["A"]);
    const avec = reportCandidates(
      [
        candidat("A", "declare", [
          {
            id: "v1",
            scrutin: "s",
            date: "2025-01-01",
            position: "pour",
            theme: "economie",
            source: null,
          },
        ]),
      ],
      ["A"],
    );
    const ids = (list: Candidat[]) => list.map((c) => c.id);
    expect(proximity(Q, reponses, liens, ids(avec))).toEqual(
      proximity(Q, reponses, liens, ids(sans)),
    );
  });

  test("P27-U-29 : candidats retirés ou non qualifiés absents du rapport", () => {
    const list = [
      candidat("A", "declare"),
      candidat("B", "retire"),
      candidat("C", "officiel"),
      candidat("D", "non_qualifie"),
      candidat("E", "declare"),
    ];
    // E n'est pas dans la liste des participants envoyée par le routeur
    expect(
      reportCandidates(list, ["A", "B", "C", "D"]).map((c) => c.id),
    ).toEqual(["A", "C"]);
  });

  test("P27-U-30 : question non éligible absente du quiz et du calcul", () => {
    const question = (id: string, eligible: boolean): QuizQuestion => ({
      id,
      enonce: id,
      statut: "validee",
      options: [],
      eligible,
      couverture: { participants: 3, positions: 3, options_occupees: 2 },
    });
    const quiz = {
      themes: [
        {
          id: "t",
          libelle: "t",
          axe: { pole_a: "a", pole_b: "b" },
          questions: [question("q01", true), question("q02", false)],
        },
      ],
    };
    const asked = quizQuestions(quiz).map((q) => q.id);
    expect(asked).toEqual(["q01"]);
    const reponses = { q01: opt("q01", "x"), q02: opt("q02", "x") };
    const liens = [
      link("q01", "A", opt("q01", "x")),
      link("q02", "A", opt("q02", "x")),
    ];
    expect(proximity(asked, reponses, liens, ["A"]).get("A")?.n).toBe(1);
  });

  // Grille aléatoire à graine fixe : réponses et positions de 4 candidats
  function randomGrid(rng: Rng) {
    const pick = <T>(items: readonly T[]) =>
      items[indexBelow(items.length, rng)] as T;
    const choices = ["x", "y", "z", AUCUNE, SANS_AVIS, "vide"] as const;
    const reponses: Record<string, string> = {};
    for (const q of Q) {
      const choice = pick(choices);
      if (choice === "vide") continue;
      reponses[q] =
        choice === AUCUNE || choice === SANS_AVIS ? choice : opt(q, choice);
    }
    const liens: Rattachement[] = [];
    for (const c of ["A", "B", "C", "D"])
      for (const q of Q) {
        const k = pick(["x", "y", "z", null] as const);
        if (k) liens.push(link(q, c, opt(q, k)));
      }
    return { reponses, liens };
  }

  test("P27-U-31 : symétrie sur 1 000 grilles", () => {
    const rng = mulberry32(31);
    for (let i = 0; i < 1_000; i += 1) {
      const { reponses, liens } = randomGrid(rng);
      const swapped = liens.map((r) => ({
        ...r,
        candidat:
          r.candidat === "A" ? "B" : r.candidat === "B" ? "A" : r.candidat,
      }));
      const before = proximity(Q, reponses, liens, ["A", "B", "C", "D"]);
      const after = proximity(Q, reponses, swapped, ["A", "B", "C", "D"]);
      expect(after.get("A")).toEqual(before.get("B"));
      expect(after.get("B")).toEqual(before.get("A"));
      expect(after.get("C")).toEqual(before.get("C"));
    }
  });

  test("P27-U-32 : l'ordre des questions et des candidats ne change aucun score", () => {
    const rng = mulberry32(32);
    for (let i = 0; i < 1_000; i += 1) {
      const { reponses, liens } = randomGrid(rng);
      const ids = ["A", "B", "C", "D"];
      const before = proximity(Q, reponses, liens, ids);
      const after = proximity(
        shuffle(Q, rng),
        reponses,
        shuffle(liens, rng),
        shuffle(ids, rng),
      );
      for (const id of ids) expect(after.get(id)).toEqual(before.get(id));
    }
  });

  test("P27-U-33 : bornes du score sur 1 000 grilles", () => {
    const rng = mulberry32(33);
    for (let i = 0; i < 1_000; i += 1) {
      const { reponses, liens } = randomGrid(rng);
      const max = counted(Q, reponses).length;
      for (const result of proximity(Q, reponses, liens, [
        "A",
        "B",
        "C",
        "D",
      ]).values()) {
        expect(result.n).toBeLessThanOrEqual(max);
        expect(result.accords).toBeLessThanOrEqual(result.n);
        if (!result.insuffisant) {
          expect(result.pourcent).toBeGreaterThanOrEqual(0);
          expect(result.pourcent).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  test("P27-U-34 : un « sans avis » ajouté ne change jamais les accords", () => {
    const rng = mulberry32(34);
    let checked = 0;
    for (let i = 0; i < 1_000; i += 1) {
      const { reponses, liens } = randomGrid(rng);
      const before = proximity(Q, reponses, liens, ["A", "B", "C", "D"]);
      for (const q of Q.filter((id) => reponses[id] === undefined)) {
        const after = proximity(Q, { ...reponses, [q]: SANS_AVIS }, liens, [
          "A",
          "B",
          "C",
          "D",
        ]);
        expect(after).toEqual(before);
        checked += 1;
      }
      // Une réponse remplacée par « sans avis » ne fait jamais monter les accords
      const q = Q[indexBelow(Q.length, rng)] as string;
      const after = proximity(Q, { ...reponses, [q]: SANS_AVIS }, liens, [
        "A",
        "B",
        "C",
        "D",
      ]);
      for (const [id, result] of after)
        expect(result.accords).toBeLessThanOrEqual(
          before.get(id)?.accords ?? 0,
        );
    }
    expect(checked).toBeGreaterThan(1_000);
  });

  test("P27-U-35 : 20 questions et 12 candidats, médiane de 50 calculs sous 200 ms", () => {
    const rng = mulberry32(35);
    const ids = Array.from({ length: 12 }, (_, i) => `c${i}`);
    const reponses = Object.fromEntries(Q.map((q) => [q, opt(q, "x")]));
    const liens = ids.flatMap((c) =>
      Q.map((q) => link(q, c, opt(q, indexBelow(2, rng) ? "x" : "y"))),
    );
    const times = Array.from({ length: 50 }, () => {
      const start = performance.now();
      proximity(Q, reponses, liens, ids);
      return performance.now() - start;
    }).sort((a, b) => a - b);
    expect(times[25]).toBeLessThan(200);
  });

  test("P27-U-51 : tri par proximité, ex aequo dans l'ordre tiré, insuffisant en fin", () => {
    const scores = new Map<string, Score>([
      ["A", score(6, 10)],
      ["B", score(3, 4)],
      ["C", score(8, 10)],
      ["D", score(6, 10)],
      ["E", score(0, 0)],
    ]);
    expect(sortByProximity(["E", "D", "B", "A", "C"], scores)).toEqual([
      "C",
      "D",
      "A",
      "E",
      "B",
    ]);
    // Ordre tiré d'origine intact
    const drawn = ["A", "B"];
    sortByProximity(drawn, scores);
    expect(drawn).toEqual(["A", "B"]);
    // Candidat sans score : en fin
    expect(sortByProximity(["Z", "C"], scores)).toEqual(["C", "Z"]);
  });
});

// Thème de test pour les barres : 2 questions, options vers A, B, mixte
function axisTheme(id = "economie"): QuizTheme {
  const options = (q: string): QuizOption[] => [
    { id: `${q}-a`, libelle: "a", pole: "a", speciale: false },
    { id: `${q}-b`, libelle: "b", pole: "b", speciale: false },
    { id: `${q}-m`, libelle: "m", pole: "mixte", speciale: false },
    {
      id: AUCUNE,
      libelle: "Aucune de ces propositions",
      pole: null,
      speciale: true,
    },
    { id: SANS_AVIS, libelle: "Sans avis", pole: null, speciale: true },
  ];
  const question = (q: string): QuizQuestion => ({
    id: q,
    enonce: q,
    statut: "validee",
    options: options(q),
    eligible: true,
    couverture: { participants: 3, positions: 3, options_occupees: 2 },
  });
  return {
    id,
    libelle: id,
    axe: { pole_a: "plus d'État", pole_b: "plus de marché" },
    questions: [question(`${id}-1`), question(`${id}-2`)],
  };
}

describe("barres à deux pôles (poles.ts)", () => {
  test("P27-U-40 : décompte écrit vers A, vers B et mixte", () => {
    const theme = axisTheme();
    const [count] = poleCounts([theme], ["economie-1", "economie-2"], {
      "economie-1": "economie-1-a",
      "economie-2": "economie-2-m",
    });
    expect(count).toMatchObject({ a: 1, b: 0, mixte: 1, valeur: 75 });
    expect(poleText(count as never)).toBe(
      "1 vers plus d'État, 0 vers plus de marché, 1 mixte",
    );
    const [other] = poleCounts([theme], ["economie-1", "economie-2"], {
      "economie-1": "economie-1-b",
      "economie-2": "economie-2-b",
    });
    expect(other).toMatchObject({ a: 0, b: 2, mixte: 0, valeur: 0 });
  });

  test("P27-U-41 : axes non gelés : barres masquées", () => {
    expect(polesVisible({ axes_statut: "gelee", barres_visibles: true })).toBe(
      true,
    );
    for (const axes_statut of ["brouillon", "validee", null] as const)
      expect(polesVisible({ axes_statut, barres_visibles: true })).toBe(false);
    expect(polesVisible({ axes_statut: "gelee", barres_visibles: false })).toBe(
      false,
    );
  });

  test("P27-U-42 : « sans avis », « aucune » et questions non posées hors des pôles", () => {
    const theme = axisTheme();
    const [count] = poleCounts([theme], ["economie-1", "economie-2"], {
      "economie-1": AUCUNE,
      "economie-2": SANS_AVIS,
    });
    expect(count).toMatchObject({ a: 0, b: 0, mixte: 0, valeur: null });
    // Question hors du quiz (non éligible) : sa réponse n'est pas comptée
    const [partial] = poleCounts([theme], ["economie-2"], {
      "economie-1": "economie-1-a",
    });
    expect(partial).toMatchObject({ a: 0, valeur: null });
    // Option ordinaire sans pôle (donnée incomplète) : hors des pôles
    const sansPole: QuizTheme = {
      ...theme,
      questions: theme.questions.map((q) => ({
        ...q,
        options: q.options.map((o) => ({ ...o, pole: null })),
      })),
    };
    const [none] = poleCounts([sansPole], ["economie-1"], {
      "economie-1": "economie-1-a",
    });
    expect(none).toMatchObject({ a: 0, b: 0, mixte: 0, valeur: null });
  });

  test("checkedQuiz : forme contrôlée, rattachements vers une option ordinaire seulement", () => {
    const theme = axisTheme();
    const quiz = quizData({
      themes: [theme],
      rattachements: [
        link("economie-1", "A", "economie-1-a"),
        link("economie-1", "B", "option-inconnue"),
        link("economie-1", "C", AUCUNE),
        link("question-inconnue", "A", "economie-1-a"),
      ],
    });
    expect(checkedQuiz(quiz).rattachements).toEqual([
      link("economie-1", "A", "economie-1-a"),
    ]);
    const broken = (patch: object) => () =>
      checkedQuiz({ ...quiz, ...patch } as QuizData);
    expect(broken({ themes: [{ ...theme, questions: undefined }] })).toThrow(
      "illisible",
    );
    expect(broken({ themes: [{ ...theme, axe: undefined }] })).toThrow(
      "illisible",
    );
    expect(
      broken({
        themes: [
          { ...theme, questions: [{ ...theme.questions[0], options: null }] },
        ],
      }),
    ).toThrow("illisible");
    expect(broken({ rattachements: null })).toThrow("illisible");
  });
});

// Stockage en mémoire (interface de localStorage), défaillances injectables
function memoryStorage(fail: Partial<Record<keyof StorageLike, boolean>> = {}) {
  const data = new Map<string, string>();
  const storage: StorageLike & { data: Map<string, string> } = {
    data,
    getItem(key) {
      if (fail.getItem) throw new Error("refusé");
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (fail.setItem) throw new Error("plein");
      data.set(key, value);
    },
    removeItem(key) {
      if (fail.removeItem) throw new Error("refusé");
      data.delete(key);
    },
  };
  return storage;
}

function quizData(overrides: Partial<QuizData> = {}): QuizData {
  return {
    disponible: true,
    message: null,
    jeu: "demonstration",
    liste: "declares",
    phase: "declares",
    version: "base-1",
    grille_version: "grille-1",
    axes_statut: "gelee",
    barres_visibles: true,
    gel: null,
    participants: ["A", "B"],
    themes: [axisTheme("economie"), axisTheme("sante")],
    rattachements: [],
    ...overrides,
  };
}

describe("ordre et mémoire du quiz (quizStorage.ts)", () => {
  test("P27-U-45 : « aucune » puis « sans avis » toujours en dernier (1 000 tirages)", () => {
    const rng = mulberry32(45);
    const options = axisTheme().questions[0]?.options as QuizOption[];
    // Options spéciales placées au milieu de la grille d'entrée
    const mixed = [
      options[3],
      options[0],
      options[4],
      options[1],
      options[2],
    ] as QuizOption[];
    const firsts = new Set<string>();
    for (let i = 0; i < 1_000; i += 1) {
      const order = optionOrder(mixed, rng);
      expect(order.slice(-2)).toEqual([AUCUNE, SANS_AVIS]);
      expect([...order].sort()).toEqual(mixed.map((o) => o.id).sort());
      firsts.add(order[0] as string);
    }
    // Les options ordinaires sont bien mélangées
    expect(firsts.size).toBe(3);
  });

  test("P27-U-46 : ordres gardés dans le stockage et repris à la réouverture", () => {
    const storage = memoryStorage();
    const quiz = quizData();
    const first = newSave(quiz, mulberry32(46));
    first.reponses["economie-1"] = "economie-1-b";
    expect(writeSave(first, storage)).toBe(true);
    const { save, notice } = resumeSave(readSave(storage), quiz, mulberry32(7));
    expect(notice).toBeNull();
    expect(save.ordre_questions).toEqual(first.ordre_questions);
    expect(save.ordre_options).toEqual(first.ordre_options);
    expect(save.reponses).toEqual({ "economie-1": "economie-1-b" });
    // Sans quiz conservé : nouveau tirage, toutes les questions éligibles
    const fresh = resumeSave(null, quiz, mulberry32(8));
    expect(fresh.notice).toBeNull();
    expect([...fresh.save.ordre_questions].sort()).toEqual([
      "economie-1",
      "economie-2",
      "sante-1",
      "sante-2",
    ]);
  });

  test("P27-U-47 : écrire, relire, effacer la clé antares.presidentielle.quiz", () => {
    const storage = memoryStorage();
    const save = newSave(quizData(), mulberry32(47));
    writeSave({ ...save, termine_le: "2027-03-20" }, storage);
    expect([...storage.data.keys()]).toEqual([QUIZ_KEY]);
    const back = readSave(storage) as QuizSave;
    expect(back.termine_le).toBe("2027-03-20");
    expect(Object.keys(back).sort()).toEqual(
      [
        "base_version",
        "grille_version",
        "ordre_options",
        "ordre_questions",
        "reponses",
        "termine_le",
      ].sort(),
    );
    expect(clearSave(storage)).toBe(true);
    expect(storage.data.size).toBe(0);
    expect(readSave(storage)).toBeNull();
  });

  test("P27-U-48 : contenu illisible ou stockage qui lève : quiz en mémoire, sans plantage", () => {
    const storage = memoryStorage();
    for (const raw of [
      "{",
      "null",
      "[]",
      '"texte"',
      JSON.stringify({ base_version: 1 }),
      JSON.stringify({
        ...newSave(quizData()),
        reponses: { q: 3 },
      }),
      JSON.stringify({ ...newSave(quizData()), ordre_options: { q: [1] } }),
      JSON.stringify({ ...newSave(quizData()), termine_le: 5 }),
    ]) {
      storage.data.set(QUIZ_KEY, raw);
      expect(readSave(storage)).toBeNull();
    }
    const broken = memoryStorage({
      getItem: true,
      setItem: true,
      removeItem: true,
    });
    expect(readSave(broken)).toBeNull();
    expect(writeSave(newSave(quizData()), broken)).toBe(false);
    expect(clearSave(broken)).toBe(false);
    expect(readSave(null)).toBeNull();
    expect(writeSave(newSave(quizData()), null)).toBe(false);
    expect(clearSave(null)).toBe(false);
    // Quiz repris sans stockage : nouveau tirage en mémoire
    expect(resumeSave(readSave(broken), quizData()).notice).toBeNull();
  });

  test("browserStorage : localStorage s'il existe, null s'il lève", () => {
    const fake = memoryStorage();
    vi.stubGlobal("localStorage", fake);
    expect(browserStorage()).toBe(fake);
    vi.unstubAllGlobals();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    try {
      expect(browserStorage()).toBeNull();
    } finally {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
    expect(browserStorage()).toBeNull();
  });

  test("P27-U-49 : base modifiée : « recalculer » proposé, réponses gardées", () => {
    const quiz = quizData();
    const saved = {
      ...newSave(quiz, mulberry32(49)),
      reponses: { "sante-2": "sante-2-a" },
    };
    const { save, notice } = resumeSave(
      saved,
      quizData({ version: "base-2" }),
      mulberry32(1),
    );
    expect(notice).toBe("base");
    expect(save.reponses).toEqual({ "sante-2": "sante-2-a" });
    expect(save.base_version).toBe("base-1");
  });

  test("P27-U-50 : grille modifiée : réponses écartées, avec un message", () => {
    const quiz = quizData();
    const saved = {
      ...newSave(quiz, mulberry32(50)),
      reponses: { "sante-2": "sante-2-a" },
      termine_le: "2027-03-01",
    };
    const { save, notice } = resumeSave(
      saved,
      quizData({ grille_version: "grille-2" }),
      mulberry32(2),
    );
    expect(notice).toBe("grille");
    expect(save.reponses).toEqual({});
    expect(save.termine_le).toBeNull();
    expect(save.grille_version).toBe("grille-2");
  });

  test("reprise : questions devenues éligibles ajoutées, options changées retirées", () => {
    const quiz = quizData();
    const restreint = quizData({
      themes: quiz.themes.map((t, i) => ({
        ...t,
        questions: t.questions.map((q) => ({ ...q, eligible: i === 0 })),
      })),
    });
    const saved = {
      ...newSave(restreint, mulberry32(3)),
      reponses: {
        "economie-1": "economie-1-a",
        "economie-2": "option-disparue",
      },
    };
    // Ordre d'options illisible pour une question : nouveau tirage
    saved.ordre_options["economie-2"] = ["x"];
    const { save } = resumeSave(saved, quiz, mulberry32(4));
    expect(save.ordre_questions.slice(0, 2)).toEqual(saved.ordre_questions);
    expect([...save.ordre_questions.slice(2)].sort()).toEqual([
      "sante-1",
      "sante-2",
    ]);
    expect(save.ordre_options["economie-1"]).toEqual(
      saved.ordre_options["economie-1"],
    );
    expect(save.ordre_options["economie-2"]?.slice(-2)).toEqual([
      AUCUNE,
      SANS_AVIS,
    ]);
    expect(save.reponses).toEqual({ "economie-1": "economie-1-a" });
    // Grille absente (quiz indisponible) : version vide
    const sansGrille = quizData({ grille_version: null });
    expect(newSave(sansGrille).grille_version).toBe("");
    expect(
      resumeSave(newSave(sansGrille), sansGrille, mulberry32(5)).notice,
    ).toBeNull();
  });
});

describe("surveillance et votes réels (lot 4b)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    presidentielleStore.setState({ nouveautes: [] });
  });

  const SIGNALEMENT = {
    url: "https://aline.exemple.invalid/programme",
    candidat: "aline-fictiva",
    nom: "Aline Fictiva",
    detecte_le: "2026-11-21T06:30:00+00:00",
  };
  const owner = { guest: false, sharing: false } as Meta;

  test("P27-U-60 : signalements mal formés écartés, réponse illisible refusée", () => {
    const answer = {
      signalements: [SIGNALEMENT, { url: 3 }, null, { ...SIGNALEMENT, nom: 1 }],
    } as unknown as Nouveautes;
    expect(checkedNouveautes(answer)).toEqual([SIGNALEMENT]);
    expect(() => checkedNouveautes({} as Nouveautes)).toThrow("illisible");
  });

  test("P27-U-61 : propriétaire seulement ; refus du routeur : rien", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ signalements: [SIGNALEMENT] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await loadSignalements({ ...owner, guest: true, sharing: true });
    await loadSignalements(null);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(presidentielleStore.getState().nouveautes).toEqual([]);
    await loadSignalements(owner);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("api/presidentielle/nouveautes");
    expect(presidentielleStore.getState().nouveautes).toEqual([SIGNALEMENT]);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: "réservé" }), { status: 403 }),
      ),
    );
    await loadSignalements(owner);
    expect(presidentielleStore.getState().nouveautes).toEqual([]);
  });

  test("P27-U-62 : chaque position de vote a un libellé, sans « n'a pas voté »", () => {
    expect(Object.keys(POSITION_LABEL).sort()).toEqual([
      "abstention",
      "contre",
      "non_votant",
      "pour",
      "sans_vote",
    ]);
    for (const label of Object.values(POSITION_LABEL))
      expect(label).not.toMatch(/n'a pas voté/i);
  });
});
