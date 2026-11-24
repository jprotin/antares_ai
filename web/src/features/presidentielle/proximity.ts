// Proximité entre les réponses du quiz et les positions des candidats : règle publiée
// dans la page Méthode, appliquée telle quelle (fonction pure, sans réseau).
// - Seules comptent les questions du quiz (éligibles) répondues par une option, ou par
//   « aucune de ces propositions » ; « sans avis » et une question laissée sans réponse
//   retirent la question du calcul pour tous les candidats.
// - Pour chaque candidat, n = questions comptées où il a une position (rattachement) ;
//   accord = même option. « Aucune » est donc un désaccord avec chaque candidat qui a
//   une position, sans effet sur les autres.
// - Pourcentage = Math.round(100 × accords / n), affiché seulement si n ≥ 10.
// - Les votes réels n'entrent pas dans le calcul : seuls les rattachements sont lus.

import type { Candidat, Rattachement } from "./types";

export const AUCUNE = "aucune";
export const SANS_AVIS = "sans-avis";
export const SEUIL = 10;

// Candidats qui participent au quiz (les retirés et non qualifiés en sont exclus)
const PARTICIPE: ReadonlySet<Candidat["statut"]> = new Set([
  "declare",
  "officiel",
]);

// Réponses : identifiant de question -> identifiant d'option
export type Reponses = Readonly<Record<string, string>>;

export type Score =
  | { insuffisant: false; pourcent: number; n: number; accords: number }
  | { insuffisant: true; n: number; accords: number };

// Score d'un candidat à partir de ses comptes
export function score(accords: number, n: number): Score {
  if (n < SEUIL) return { insuffisant: true, n, accords };
  return {
    insuffisant: false,
    pourcent: Math.round((100 * accords) / n),
    n,
    accords,
  };
}

const pluriel = (n: number) => (n > 1 ? "questions" : "question");

// « 60 %, sur 15 questions » ou « données insuffisantes (6 questions) »
export function scoreText(result: Score): string {
  if (result.insuffisant)
    return `données insuffisantes (${result.n} ${pluriel(result.n)})`;
  return `${result.pourcent} %, sur ${result.n} ${pluriel(result.n)}`;
}

// Questions comptées : celles du quiz qui ont une réponse autre que « sans avis »
export function counted(
  questions: readonly string[],
  reponses: Reponses,
): string[] {
  return questions.filter((q) => {
    const answer = reponses[q];
    return answer !== undefined && answer !== SANS_AVIS;
  });
}

// Scores de chaque candidat demandé, sur les questions du quiz
export function proximity(
  questions: readonly string[],
  reponses: Reponses,
  rattachements: readonly Rattachement[],
  candidats: readonly string[],
): Map<string, Score> {
  const kept = new Set(counted(questions, reponses));
  const wanted = new Set(candidats);
  const tally = new Map(candidats.map((c) => [c, { n: 0, accords: 0 }]));
  const seen = new Set<string>();
  for (const r of rattachements) {
    if (!kept.has(r.question) || !wanted.has(r.candidat)) continue;
    // Une position au plus par candidat et par question (contrôlé par le schéma)
    const key = `${r.question}\n${r.candidat}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const count = tally.get(r.candidat) as { n: number; accords: number };
    count.n += 1;
    if (reponses[r.question] === r.option) count.accords += 1;
  }
  return new Map(
    candidats.map((c) => {
      const { accords, n } = tally.get(c) as { n: number; accords: number };
      return [c, score(accords, n)];
    }),
  );
}

// Candidats du rapport : participants du quiz encore en lice, dans l'ordre reçu
export function reportCandidates(
  candidats: readonly Candidat[],
  participants: readonly string[],
): Candidat[] {
  const allowed = new Set(participants);
  return candidats.filter((c) => allowed.has(c.id) && PARTICIPE.has(c.statut));
}

// Tri à la demande : pourcentage décroissant, ex aequo dans l'ordre tiré, « données
// insuffisantes » en fin (dans l'ordre tiré)
export function sortByProximity<T extends string>(
  order: readonly T[],
  scores: ReadonlyMap<string, Score>,
): T[] {
  const rank = (id: T) => {
    const result = scores.get(id);
    return result && !result.insuffisant ? result.pourcent : -1;
  };
  return order
    .map((id, index) => ({ id, index }))
    .sort((a, b) => rank(b.id) - rank(a.id) || a.index - b.index)
    .map(({ id }) => id);
}
