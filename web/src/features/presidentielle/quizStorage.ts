// Mémoire du quiz, dans ce navigateur seulement (clé antares.presidentielle.quiz) : versions
// de la base et de la grille, ordre tiré des questions et des options, réponses, date de
// fin. Rien ne part vers le serveur. Chaque accès au stockage est protégé : stockage
// indisponible ou contenu illisible, le quiz continue en mémoire.
// Ordre des options : tiré au sort, puis « aucune de ces propositions » et « sans avis »
// toujours en dernier.

import { AUCUNE, SANS_AVIS } from "./proximity";
import { shuffle, type Rng } from "./shuffle";
import type { QuizData, QuizOption, QuizQuestion } from "./types";

export const QUIZ_KEY = "antares.presidentielle.quiz";

export type QuizSave = {
  base_version: string;
  grille_version: string;
  ordre_questions: string[];
  ordre_options: Record<string, string[]>;
  reponses: Record<string, string>;
  termine_le: string | null;
};

// « base » : base modifiée depuis le quiz (recalcul proposé) ; « grille » : grille
// changée, réponses écartées
export type ResumeNotice = "base" | "grille" | null;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function checked(value: unknown): QuizSave | null {
  if (!isRecord(value)) return null;
  const {
    base_version,
    grille_version,
    ordre_questions,
    ordre_options,
    reponses,
    termine_le,
  } = value;
  if (
    typeof base_version !== "string" ||
    typeof grille_version !== "string" ||
    !isStrings(ordre_questions) ||
    !isRecord(ordre_options) ||
    !Object.values(ordre_options).every(isStrings) ||
    !isRecord(reponses) ||
    !Object.values(reponses).every((v) => typeof v === "string") ||
    !(termine_le === null || typeof termine_le === "string")
  )
    return null;
  return {
    base_version,
    grille_version,
    ordre_questions,
    ordre_options: ordre_options as Record<string, string[]>,
    reponses: reponses as Record<string, string>,
    termine_le,
  };
}

export function readSave(
  storage: StorageLike | null = browserStorage(),
): QuizSave | null {
  try {
    const raw = storage?.getItem(QUIZ_KEY);
    return raw ? checked(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeSave(
  save: QuizSave,
  storage: StorageLike | null = browserStorage(),
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(QUIZ_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(
  storage: StorageLike | null = browserStorage(),
): boolean {
  try {
    if (!storage) return false;
    storage.removeItem(QUIZ_KEY);
    return true;
  } catch {
    return false;
  }
}

// Options mélangées, « aucune » puis « sans avis » en dernier
export function optionOrder(
  options: readonly QuizOption[],
  rng?: Rng,
): string[] {
  const ordinary = options
    .filter((o) => o.id !== AUCUNE && o.id !== SANS_AVIS)
    .map((o) => o.id);
  const last = [AUCUNE, SANS_AVIS].filter((id) =>
    options.some((o) => o.id === id),
  );
  return [...shuffle(ordinary, rng), ...last];
}

// Questions posées : éligibles (validées et assez couvertes), dans l'ordre de la grille
export function quizQuestions(quiz: Pick<QuizData, "themes">): QuizQuestion[] {
  return quiz.themes.flatMap((t) => t.questions.filter((q) => q.eligible));
}

export function newSave(quiz: QuizData, rng?: Rng): QuizSave {
  const questions = quizQuestions(quiz);
  return {
    base_version: quiz.version,
    grille_version: quiz.grille_version ?? "",
    ordre_questions: shuffle(
      questions.map((q) => q.id),
      rng,
    ),
    ordre_options: Object.fromEntries(
      questions.map((q) => [q.id, optionOrder(q.options, rng)]),
    ),
    reponses: {},
    termine_le: null,
  };
}

const samePermutation = (order: readonly string[], ids: readonly string[]) =>
  order.length === ids.length &&
  [...order].sort().join("\n") === [...ids].sort().join("\n");

// Reprise d'un quiz conservé : même grille, ordres et réponses repris (questions
// devenues éligibles ajoutées à la fin, dans un ordre tiré) ; grille changée, réponses
// écartées ; base changée, réponses gardées et recalcul proposé.
export function resumeSave(
  saved: QuizSave | null,
  quiz: QuizData,
  rng?: Rng,
): { save: QuizSave; notice: ResumeNotice } {
  if (!saved) return { save: newSave(quiz, rng), notice: null };
  if (saved.grille_version !== (quiz.grille_version ?? ""))
    return { save: newSave(quiz, rng), notice: "grille" };
  const questions = quizQuestions(quiz);
  const eligible = new Set(questions.map((q) => q.id));
  const kept = saved.ordre_questions.filter((id) => eligible.has(id));
  const added = shuffle(
    questions.map((q) => q.id).filter((id) => !kept.includes(id)),
    rng,
  );
  const ordre_options: Record<string, string[]> = {};
  for (const question of questions) {
    const ids = question.options.map((o) => o.id);
    const previous = saved.ordre_options[question.id];
    ordre_options[question.id] =
      previous && samePermutation(previous, ids)
        ? previous
        : optionOrder(question.options, rng);
  }
  // Réponses gardées si l'option existe encore dans la grille
  const options = new Map(
    quiz.themes.flatMap((t) =>
      t.questions.map((q) => [q.id, new Set(q.options.map((o) => o.id))]),
    ),
  );
  const reponses = Object.fromEntries(
    Object.entries(saved.reponses).filter(([q, o]) => options.get(q)?.has(o)),
  );
  return {
    save: {
      ...saved,
      ordre_questions: [...kept, ...added],
      ordre_options,
      reponses,
    },
    notice: saved.base_version === quiz.version ? null : "base",
  };
}
