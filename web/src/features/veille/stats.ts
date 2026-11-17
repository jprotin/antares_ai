// Statistiques de la veille : logique pure (contrôle de la réponse du routeur, géométrie
// des anneaux, échelles, libellés). Testée par tests/unit/veille-stats.test.ts.
import type {
  VeilleCategory,
  VeilleStats,
  VeilleStatsCategory,
} from "@/types/api";

type Json = Record<string, unknown>;

export const STATS_PERIODS = [
  { days: 7, label: "7 jours" },
  { days: 30, label: "30 jours" },
  { days: 365, label: "1 an" },
] as const;

export type StatsPeriod = (typeof STATS_PERIODS)[number]["days"];

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
const rate = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const list = (value: unknown): Json[] =>
  Array.isArray(value) ? value.filter(isObject) : [];

function categoryRows(value: unknown): VeilleStatsCategory[] {
  return list(value).map((c) => ({
    slug: text(c.slug),
    label: text(c.label) || text(c.slug) || "Autre",
    count: count(c.count),
    share: rate(c.share),
  }));
}

// Réponse de api/veille/stats, ou null si sa forme est inattendue
export function parseStats(value: unknown): VeilleStats | null {
  if (!isObject(value) || !isObject(value.summary)) return null;
  const s = value.summary;
  const tastes = isObject(value.tastes) ? value.tastes : {};
  const ai = isObject(value.ai) ? value.ai : {};
  const tasteCategories = list(tastes.categories);
  return {
    days: count(value.days),
    since: text(value.since),
    until: text(value.until),
    summary: {
      likes: count(s.likes),
      dislikes: count(s.dislikes),
      agreement: rate(s.agreement),
      agreement_votes: count(s.agreement_votes),
      missed_likes: count(s.missed_likes),
      featured: count(s.featured),
      collected: count(s.collected),
      ideas_interested: count(s.ideas_interested),
      ideas_rejected: count(s.ideas_rejected),
    },
    tastes: {
      categories: categoryRows(tasteCategories).map((c, i) => ({
        ...c,
        dislikes: count(tasteCategories[i]?.dislikes),
      })),
      sources: list(tastes.sources)
        .filter((r) => text(r.name))
        .map((r) => ({
          name: text(r.name),
          likes: count(r.likes),
          dislikes: count(r.dislikes),
          like_rate: rate(r.like_rate),
        })),
      words: list(tastes.words)
        .filter((r) => text(r.word))
        .map((r) => ({ word: text(r.word), count: count(r.count) })),
    },
    ai: {
      categories: categoryRows(ai.categories),
      sources: list(ai.sources)
        .filter((r) => text(r.name))
        .map((r) => ({
          name: text(r.name),
          featured: count(r.featured),
          share: rate(r.share),
          collected: count(r.collected),
          selection_rate: rate(r.selection_rate),
        })),
    },
    timeline: list(value.timeline)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(text(d.day)))
      .map((d) => ({
        day: text(d.day),
        featured: Object.fromEntries(
          Object.entries(isObject(d.featured) ? d.featured : {}).map(
            ([k, v]) => [k, count(v)],
          ),
        ),
        agree_likes: count(d.agree_likes),
        agree_dislikes: count(d.agree_dislikes),
        missed_likes: count(d.missed_likes),
      })),
  };
}

// « 38 % », « 66,7 % » ; absent : « – »
export function percent(value: number | null | undefined): string {
  if (typeof value !== "number") return "–";
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

// Couleur d'une catégorie (1 à 6, dans l'ordre du routeur) ; 0 : neutre
export function seriesSlot(
  slug: string,
  categories: readonly VeilleCategory[],
): number {
  const index = categories.findIndex((c) => c.slug === slug);
  return index >= 0 && index < 6 ? index + 1 : 0;
}

// Secteurs d'un anneau (centre 0,0) : un chemin par valeur non nulle, séparés par un
// interstice de `gap` (unité du rayon) ; une seule valeur : anneau complet
export function donutPaths(
  values: readonly number[],
  radius: number,
  inner: number,
  gap = 2,
): { index: number; path: string }[] {
  const total = values.reduce((sum, v) => sum + Math.max(0, v), 0);
  if (total <= 0) return [];
  const shown = values
    .map((value, index) => ({ value, index }))
    .filter((v) => v.value > 0);
  const point = (r: number, angle: number) =>
    `${round(r * Math.sin(angle))} ${round(-r * Math.cos(angle))}`;
  if (shown.length === 1) {
    const ring = (r: number) =>
      `M 0 ${-r} A ${r} ${r} 0 1 1 0 ${r} A ${r} ${r} 0 1 1 0 ${-r} Z`;
    return [{ index: shown[0]!.index, path: `${ring(radius)} ${ring(inner)}` }];
  }
  let start = 0;
  return shown.map(({ value, index }) => {
    const sweep = (value / total) * 2 * Math.PI;
    const outerPad = gap / 2 / radius;
    const innerPad = gap / 2 / inner;
    const a0 = start + outerPad;
    const a1 = start + sweep - outerPad;
    const b0 = start + innerPad;
    const b1 = start + sweep - innerPad;
    const large = sweep > Math.PI ? 1 : 0;
    start += sweep;
    return {
      index,
      path:
        `M ${point(radius, a0)} A ${radius} ${radius} 0 ${large} 1 ${point(radius, a1)} ` +
        `L ${point(inner, b1)} A ${inner} ${inner} 0 ${large} 0 ${point(inner, b0)} Z`,
    };
  });
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// Maximum d'axe arrondi (1, 2, 5 × 10ⁿ) ; 1 au moins
export function niceMax(value: number): number {
  if (value <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((m) => m * power >= value) ?? 10;
  return step * power;
}

// Taux d'accord par jour (null : aucun vote sur un article à la une ce jour-là)
export function agreementByDay(
  timeline: VeilleStats["timeline"],
): { day: string; value: number | null }[] {
  return timeline.map((d) => {
    const votes = d.agree_likes + d.agree_dislikes;
    return {
      day: d.day,
      value: votes ? Math.round((1000 * d.agree_likes) / votes) / 10 : null,
    };
  });
}

const SHORT = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});

// « 16 nov. » pour un jour AAAA-MM-JJ
export function shortDay(day: string): string {
  const time = Date.parse(`${day}T12:00:00Z`);
  return Number.isNaN(time) ? day : SHORT.format(time);
}

// « 3 articles », « 1 article »
export const articles = (n: number) => `${n} article${n > 1 ? "s" : ""}`;
