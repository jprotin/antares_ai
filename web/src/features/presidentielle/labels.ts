// Libellés affichés : statuts, niveaux de source, natures de texte, dates. Les mêmes
// mots pour tous les candidats.
import type {
  MesureRetireeErreur,
  MesureVersion,
  Niveau,
  Statut,
  Vote,
} from "./types";

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
  non_votant: "Non-votant",
  sans_vote: "Aucun vote enregistré",
};

export const NO_POSITION = "Pas de position connue à ce jour";
export const ENTRE_TOURS = "Entre les deux tours";
export const NO_HEADLINE = "Aucune ligne phare annoncée";
export const NO_MEASURE = "Aucune mesure relue à ce jour";
export const OTHER_MEASURES = "Autres mesures";
// Même texte que le routeur (presidentielle_api.GRILLE_NON_PUBLIEE)
export const NO_GRID = "La grille du quiz n'est pas encore publiée.";

// Libellé du thème d'une mesure : celui servi avec la mesure, sinon celui de la liste
// des thèmes, sinon l'identifiant
export function themeLabel(
  mesure: { theme: string; theme_libelle?: string },
  themes: Map<string, string>,
): string {
  return mesure.theme_libelle ?? themes.get(mesure.theme) ?? mesure.theme;
}

// Vue « Évolution » : constats seulement, aucun qualificatif
export const BLOC_LABEL = {
  ajoute: "Ajouté",
  retire: "Retiré",
  modifie: "Modifié",
} as const;
export const BAD_COPY =
  "Contenu non affiché : copie figée illisible, signalée au propriétaire";
export const NO_COPY =
  "Contenu non conservé : version publiée avant la première copie figée";
export const NO_PROGRAMME_VERSIONS =
  "Aucun document de programme en plusieurs versions à ce jour";

// Mesure retirée parce qu'erronée (journal : retraits_erreur) : ni citation ni source,
// seulement la date du retrait
export function retireeErreur(
  mesure: MesureVersion,
): mesure is MesureRetireeErreur {
  return typeof (mesure as MesureRetireeErreur).retrait_erreur === "string";
}

export function retraitErreurLabel(date: string): string {
  return `Mesure retirée le ${formatDate(date)} (erreur de saisie corrigée)`;
}

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
