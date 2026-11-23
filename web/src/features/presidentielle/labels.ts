// Libellés affichés : statuts, niveaux de source, natures de texte, dates. Les mêmes
// mots pour tous les candidats.
import type { Niveau, Statut, Vote } from "./types";

export const PAGE_TITLE = "Présidentielle 2027";

export const STATUT_LABEL: Record<Statut, string> = {
  declare: "Déclaré",
  officiel: "Officiel",
  retire: "Retiré",
  non_qualifie: "Non qualifié",
};

export const NIVEAU_LABEL: Record<Niveau, string> = {
  officiel_etat: "Officiel État",
  candidat: "Document du candidat",
  vote_reel: "Vote réel",
};

export const NATURE_LABEL = {
  candidat: "du candidat",
  redaction: "de la rédaction",
} as const;

export const POSITION_LABEL: Record<Vote["position"], string> = {
  pour: "Pour",
  contre: "Contre",
  abstention: "Abstention",
};

export const NO_POSITION = "Pas de position connue à ce jour";
export const NO_HEADLINE = "Aucune ligne phare annoncée";

const DATE = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

// "2026-11-20" -> « 20 novembre 2026 » ; valeur illisible : rendue telle quelle
export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [year, month, day] = [match[1], match[2], match[3]].map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC reporte les débordements (13e mois, 45e jour) : refusés
  const exact =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return exact ? DATE.format(date) : value;
}

// Seules les adresses https deviennent des liens
export function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
