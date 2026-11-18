// Tableau de bord : logique pure (sélection des articles), testée par
// tests/unit/home.test.ts.
import type { VeilleItem, VeilleRun } from "@/types/api";

import { dayItems, parseStamp } from "@/features/veille";

export const TOP = 5;
// Jours relus pour le top de la semaine
export const WEEK_DAYS = 7;

// À la une du jour : articles de tous les passages, le plus récent d'abord ; ceux que
// l'utilisateur a aimés en tête, ceux qu'il a rejetés écartés
export function dayTop(runs: readonly VeilleRun[], limit = TOP): VeilleItem[] {
  const items = dayItems(runs)
    .map((entry) => entry.value)
    .filter((item) => item.vote !== "dislike");
  const liked = items.filter((item) => item.vote === "like");
  return [...liked, ...items.filter((item) => item.vote !== "like")].slice(
    0,
    limit,
  );
}

// Top de la semaine : articles aimés des derniers jours (le plus récent d'abord), complétés
// par la une de chaque jour, du plus récent au plus ancien ; sans doublon
export function weekTop(
  days: readonly (readonly VeilleRun[])[],
  limit = TOP,
): VeilleItem[] {
  const seen = new Set<string>();
  const unique = (item: VeilleItem) => {
    const key = item.id ?? item.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const all = days.flatMap((runs) => dayItems(runs).map((e) => e.value));
  const recent = (a: VeilleItem, b: VeilleItem) =>
    (parseStamp(b.published_at) ?? 0) - (parseStamp(a.published_at) ?? 0);
  const liked = all.filter((item) => item.vote === "like").sort(recent);
  const rest = days.flatMap((runs) => dayTop(runs, 2));
  return [...liked, ...rest].filter(unique).slice(0, limit);
}
