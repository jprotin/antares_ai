// Lectures de la base « Présidentielle 2027 » (routeur, lecture seule) : base publiée,
// méta (partage, invité, cible), grille du quiz, nouveautés de la surveillance
// (propriétaire seulement) et évolution d'une fiche. Erreurs avec leur statut HTTP
// (0 : serveur injoignable).
import { detailMessage } from "@/lib/api";

import { retireeErreur } from "./labels";
import type {
  BasePubliee,
  Changements,
  Comparaison,
  Evolution,
  MesureVersion,
  Meta,
  Nouveautes,
  QuizData,
  Signalement,
} from "./types";

export class PresidentielleApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PresidentielleApiError";
    this.status = status;
  }
}

async function read<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch {
    throw new PresidentielleApiError("le serveur est injoignable", 0);
  }
  if (!response.ok) {
    const { detail } = (await response.json().catch(() => ({}))) as {
      detail?: unknown;
    };
    throw new PresidentielleApiError(
      detailMessage(detail) ?? `erreur HTTP ${response.status}`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

function checkedBase(answer: BasePubliee): BasePubliee {
  if (
    !answer ||
    typeof answer.version !== "string" ||
    !Array.isArray(answer.candidats) ||
    !Array.isArray(answer.themes) ||
    !Array.isArray(answer.journal)
  )
    throw new PresidentielleApiError("réponse du routeur illisible", 502);
  return answer;
}

export async function loadBase(): Promise<BasePubliee> {
  return checkedBase(await read<BasePubliee>("api/presidentielle"));
}

export function loadMeta(): Promise<Meta> {
  return read<Meta>("api/presidentielle/meta");
}

// Grille du quiz et rattachements : lue une fois à l'ouverture de la sous-page Quiz ;
// les réponses ne partent jamais vers le serveur
// Contrôle de forme jusqu'aux options ; rattachements gardés seulement s'ils visent une
// option ordinaire de leur question (le calcul et le détail lisent les mêmes liens)
export function checkedQuiz(answer: QuizData): QuizData {
  const wellFormed =
    answer &&
    typeof answer.version === "string" &&
    Array.isArray(answer.themes) &&
    Array.isArray(answer.rattachements) &&
    Array.isArray(answer.participants) &&
    answer.themes.every(
      (t) =>
        t &&
        typeof t.axe?.pole_a === "string" &&
        typeof t.axe?.pole_b === "string" &&
        Array.isArray(t.questions) &&
        t.questions.every(
          (q) =>
            q &&
            typeof q.id === "string" &&
            typeof q.enonce === "string" &&
            Array.isArray(q.options) &&
            q.options.every((o) => o && typeof o.id === "string"),
        ),
    );
  if (!wellFormed)
    throw new PresidentielleApiError("réponse du routeur illisible", 502);
  const ordinary = new Map(
    answer.themes.flatMap((t) =>
      t.questions.map((q) => [
        q.id,
        new Set(q.options.filter((o) => !o.speciale).map((o) => o.id)),
      ]),
    ),
  );
  return {
    ...answer,
    rattachements: answer.rattachements.filter(
      (r) => r && ordinary.get(r.question)?.has(r.option),
    ),
  };
}

export async function loadQuiz(): Promise<QuizData> {
  return checkedQuiz(await read<QuizData>("api/presidentielle/quiz"));
}

// Nouveautés de la surveillance : seuls les signalements bien formés sont gardés
export function checkedNouveautes(answer: Nouveautes): Signalement[] {
  if (!answer || !Array.isArray(answer.signalements))
    throw new PresidentielleApiError("réponse du routeur illisible", 502);
  return answer.signalements.filter(
    (s) =>
      s &&
      typeof s.url === "string" &&
      typeof s.candidat === "string" &&
      typeof s.nom === "string" &&
      typeof s.detecte_le === "string",
  );
}

export async function loadNouveautes(): Promise<Signalement[]> {
  return checkedNouveautes(
    await read<Nouveautes>("api/presidentielle/nouveautes"),
  );
}

// Vue « Évolution » d'une fiche : lue à l'ouverture de l'onglet ; contrôle de forme
// jusqu'aux listes (versions, programmes et blocs mal formés écartés)
export function checkedEvolution(answer: Evolution): Evolution {
  if (
    !answer ||
    typeof answer.candidat !== "string" ||
    !Array.isArray(answer.versions) ||
    !Array.isArray(answer.programmes)
  )
    throw new PresidentielleApiError("réponse du routeur illisible", 502);
  return {
    ...answer,
    versions: answer.versions
      .filter((v) => v && typeof v.version === "number")
      .map((v) => ({ ...v, changements: checkedChangements(v.changements) })),
    programmes: answer.programmes.filter(
      (p) =>
        p &&
        Array.isArray(p.versions) &&
        p.versions.length > 1 &&
        p.versions.every((v) => v && typeof v.id === "string") &&
        Array.isArray(p.mesures),
    ),
  };
}

// Mesure retirée parce qu'erronée : identifiant et date seulement, quoi que le routeur
// ait renvoyé d'autre (le texte n'atteint jamais le rendu)
function masquee(mesure: MesureVersion): MesureVersion {
  return retireeErreur(mesure)
    ? { id: mesure.id, retrait_erreur: mesure.retrait_erreur }
    : mesure;
}

// Changements d'une version : listes absentes ou mal formées remplacées par des listes
// vides (le rendu ne plante jamais sur une réponse partielle)
function checkedChangements(value: Changements | null): Changements | null {
  if (!value || typeof value !== "object") return null;
  const list = <T>(items: T[] | undefined): T[] =>
    Array.isArray(items) ? items.filter(Boolean) : [];
  const mesures = (items: MesureVersion[] | undefined) =>
    list(items).map(masquee);
  return {
    mesures_ajoutees: mesures(value.mesures_ajoutees),
    mesures_retirees: mesures(value.mesures_retirees),
    mesures_reformulees: list(value.mesures_reformulees)
      .filter((m) => m.avant && m.apres)
      .map((m) => ({ ...m, avant: masquee(m.avant), apres: masquee(m.apres) })),
    nouvelles_sources: list(value.nouvelles_sources),
    statut: value.statut ?? null,
  };
}

export async function loadEvolution(candidat: string): Promise<Evolution> {
  return checkedEvolution(
    await read<Evolution>(
      `api/presidentielle/evolution/${encodeURIComponent(candidat)}`,
    ),
  );
}

export function checkedComparaison(answer: Comparaison): Comparaison {
  if (!answer || !Array.isArray(answer.blocs))
    throw new PresidentielleApiError("réponse du routeur illisible", 502);
  return {
    ...answer,
    blocs: answer.blocs.filter(
      (b) =>
        b &&
        (b.type === "ajoute" || b.type === "retire" || b.type === "modifie"),
    ),
  };
}

export async function loadComparaison(
  candidat: string,
  de: string,
  a: string,
): Promise<Comparaison> {
  const query = new URLSearchParams({ de, a });
  return checkedComparaison(
    await read<Comparaison>(
      `api/presidentielle/evolution/${encodeURIComponent(candidat)}/comparaison?${query}`,
    ),
  );
}
