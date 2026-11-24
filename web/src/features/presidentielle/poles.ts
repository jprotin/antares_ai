// Barres à deux pôles (fonction pure) : par thème, décompte des réponses placées vers le
// pôle A, vers le pôle B et « mixte », d'après la place de chaque option sur l'axe du
// thème (grille relue). « Sans avis », « aucune de ces propositions » et les questions
// sans réponse ne comptent dans aucun pôle. Les barres restent masquées tant que les
// axes ne sont pas gelés.
// Valeur de la barre (0 à 100, de B vers A) : part des réponses vers A, une réponse
// « mixte » comptant pour moitié de chaque côté ; null sans réponse placée.

import type { Reponses } from "./proximity";
import type { QuizData, QuizTheme } from "./types";

export type PoleCount = {
  theme: QuizTheme;
  a: number;
  b: number;
  mixte: number;
  // Position sur l'axe, de 0 (tout vers B) à 100 (tout vers A) ; null sans réponse placée
  valeur: number | null;
};

export function poleCounts(
  themes: readonly QuizTheme[],
  questions: readonly string[],
  reponses: Reponses,
): PoleCount[] {
  const asked = new Set(questions);
  return themes.map((theme) => {
    const count = { a: 0, b: 0, mixte: 0 };
    for (const question of theme.questions) {
      if (!asked.has(question.id)) continue;
      const option = question.options.find(
        (o) => o.id === reponses[question.id],
      );
      if (!option || option.speciale || option.pole === null) continue;
      count[option.pole] += 1;
    }
    const total = count.a + count.b + count.mixte;
    const valeur = total
      ? Math.round((100 * (count.a + count.mixte / 2)) / total)
      : null;
    return { theme, ...count, valeur };
  });
}

// Barres visibles seulement une fois les axes gelés (règle de la spec)
export function polesVisible(
  quiz: Pick<QuizData, "axes_statut" | "barres_visibles">,
): boolean {
  return quiz.barres_visibles && quiz.axes_statut === "gelee";
}

// « 1 vers plus d'État, 0 vers plus de marché, 1 mixte »
export function poleText(count: PoleCount): string {
  const { pole_a, pole_b } = count.theme.axe;
  return `${count.a} vers ${pole_a}, ${count.b} vers ${pole_b}, ${count.mixte} mixte`;
}
