// Contrat des routes GET /api/presidentielle, /meta et /quiz (routeur :
// deploy/s2s/router/presidentielle_api.py). Types propres à la fonctionnalité.

export type Niveau = "officiel_etat" | "candidat" | "vote_reel";
export type Statut = "declare" | "officiel" | "retire" | "non_qualifie";
export type StatutAxes = "brouillon" | "validee" | "gelee";
export type Jeu = "demonstration" | "reel";

export type Source = {
  id: string;
  titre: string;
  url: string;
  niveau: Niveau;
  publie_le: string | null;
  consulte_le: string;
};

export type LignePhare = {
  texte: string;
  nature: "candidat";
  source: Source | null;
};

export type Mesure = {
  id: string;
  theme: string;
  citation: string;
  nature: "candidat";
  resume: string | null;
  source: Source | null;
  page: number | null;
  ajoutee_le: string;
};

export type Vote = {
  id: string;
  scrutin: string;
  date: string;
  position: "pour" | "contre" | "abstention";
  theme: string | null;
  source: Source | null;
};

export type Candidat = {
  id: string;
  nom_affiche: string;
  initiales: string;
  alias: string[];
  fictif: boolean;
  statut: Statut;
  statut_source: Source | null;
  declaration: { date: string; source: Source | null };
  description: { texte: string; nature: "redaction" };
  lignes_phares: LignePhare[];
  mesures: Mesure[];
  parlementaire: boolean;
  votes: Vote[];
  version: number;
  mise_a_jour: string;
  relue_le: string | null;
};

export type Theme = {
  id: string;
  libelle: string;
  axe: { pole_a: string; pole_b: string };
};

export type EntreeJournal = {
  date: string;
  objet: string;
  cible?: string;
  version?: number;
  motif: string;
  empreinte?: string;
};

// En-tête commun aux trois routes
export type Entete = {
  disponible: boolean;
  message: string | null;
  jeu: Jeu | null;
  liste: "declares" | "officielle" | null;
  phase: string | null;
  version: string;
};

export type BasePubliee = Entete & {
  tours: { premier: string; second: string } | null;
  archive_apres: string | null;
  axes_statut: StatutAxes | null;
  themes: Theme[];
  candidats: Candidat[];
  journal: EntreeJournal[];
};

export type Meta = Entete & {
  sharing: boolean;
  guest: boolean;
  appel_en_cours: boolean;
  assistant: {
    modele: string | null;
    modeles_autorises: string[];
    message: string | null;
  };
  cible: "local" | "cloud";
  fiches: number;
  erreurs?: unknown[];
};
