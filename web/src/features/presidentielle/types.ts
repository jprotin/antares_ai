// Contrat des routes GET /api/presidentielle, /meta et /quiz (routeur :
// deploy/s2s/router/presidentielle_api.py). Types propres à la fonctionnalité.

export type Niveau = "officiel_etat" | "candidat" | "vote_reel";
export type Statut = "declare" | "officiel" | "retire" | "non_qualifie";
export type StatutAxes = "brouillon" | "validee" | "gelee";
export type Jeu = "demonstration" | "reel";
// Phase effective (lot 5) : « archive » après archive_apres (heure de Paris) ; entre
// les tours, les routes ne servent que les 2 qualifiés
export type Phase = "declares" | "officiel" | "entre_tours" | "archive";

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

// Forme publiée d'une mesure (routeur : presidentielle.mesure_publiee), la même dans la
// fiche, l'assistant et l'évolution
export type MesureForme = {
  id: string;
  theme: string;
  // Libellé du thème (grille, sinon référence, sinon l'identifiant)
  theme_libelle?: string;
  citation: string;
  source: Source | null;
  page: number | null;
  ajoutee_le?: string;
  // Ajoutée après le premier tour, base passée à l'entre-deux-tours
  entre_tours?: boolean;
};

export type Mesure = {
  id: string;
  theme: string;
  theme_libelle?: string;
  citation: string;
  nature: "candidat";
  resume: string | null;
  source: Source | null;
  page: number | null;
  ajoutee_le: string;
  // Ajoutée après le premier tour : marque « entre les deux tours »
  entre_tours?: boolean;
};

export type Vote = {
  id: string;
  scrutin: string;
  date: string;
  // non_votant : inscrit parmi les non-votants ; sans_vote : aucun vote enregistré
  position: "pour" | "contre" | "abstention" | "non_votant" | "sans_vote";
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

// Thèmes de la grille, puis thèmes des fiches hors quiz (sans axe) ; grille absente ou
// en défaut : thèmes déduits des mesures publiées, sans axe
export type Theme = {
  id: string;
  libelle: string;
  axe: { pole_a: string; pole_b: string } | null;
  // Thème des fiches seulement : ni question, ni axe, ni rapport du quiz
  hors_quiz?: boolean;
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
  phase: Phase | null;
  // Les 2 qualifiés (entre les tours et en archive) ; vide sinon
  qualifies?: string[];
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

// POST /api/presidentielle/ask (lot 2) : réponse faite de passages relus seulement
export type AskKind = "refus" | "fiche" | "theme" | "recherche";

export type AskPassage = MesureForme & {
  // Identifiant du passage (p27:<candidat>:<mesure>)
  id: string;
  candidat: string;
  nom: string;
  nature: "candidat";
};

export type AskAnswer = {
  kind: AskKind;
  introduction: string;
  theme: { id: string; libelle: string } | null;
  ordre: string[];
  passages: AskPassage[];
  sans_position: { candidat: string; nom: string; texte: string }[];
  model: string | null;
  moteur: "mots" | "sens" | null;
  base_version: string;
};

// Corps envoyé : la question, l'ordre de la visite et la mention d'un appel en cours,
// rien d'autre (ni historique, ni réponse du quiz)
export type AskBody = {
  question: string;
  ordre: string[];
  appel_en_cours: boolean;
};

// GET /api/presidentielle/quiz (lot 3) : grille, éligibilité de chaque question et
// rattachements (une option au plus par candidat et par question, par une mesure citée)
export type QuizOption = {
  id: string;
  libelle: string;
  pole: "a" | "b" | "mixte" | null;
  speciale: boolean;
};

export type QuizQuestion = {
  id: string;
  enonce: string;
  statut: "brouillon" | "validee";
  options: QuizOption[];
  eligible: boolean;
  couverture: {
    participants: number;
    positions: number;
    options_occupees: number;
  };
};

export type QuizTheme = {
  id: string;
  libelle: string;
  axe: { pole_a: string; pole_b: string };
  questions: QuizQuestion[];
};

export type Rattachement = {
  question: string;
  candidat: string;
  option: string;
  mesure_id: string;
};

export type QuizData = Entete & {
  grille_version: string | null;
  axes_statut: StatutAxes | null;
  barres_visibles: boolean;
  gel: { le: string; empreinte: string } | null;
  participants: string[];
  themes: QuizTheme[];
  rattachements: Rattachement[];
};

// GET /api/presidentielle/nouveautes (lot 4b) : pages suivies modifiées depuis la
// dernière relecture de la fiche ; propriétaire ou accès local seulement (403 sinon)
export type Signalement = {
  url: string;
  candidat: string;
  nom: string;
  detecte_le: string;
};

export type Nouveautes = {
  signalements: Signalement[];
  pages_suivies: number;
  en_erreur: number;
  derniere_visite: string | null;
};

// GET /api/presidentielle/evolution/{candidat} : frise des versions figées de la fiche
// et documents de programme en plusieurs versions (presidentielle_evolution.py). Texte
// des fiches et des documents seulement, aucun résumé.
export type MesureVersion = MesureForme | MesureRetireeErreur;

// Mesure retirée parce qu'erronée (journal : retraits_erreur) : identifiant et date du
// retrait seulement, dans toutes les versions qui la contenaient ; ni citation ni source
export type MesureRetireeErreur = { id: string; retrait_erreur: string };

export type Changements = {
  mesures_ajoutees: MesureVersion[];
  mesures_retirees: MesureVersion[];
  mesures_reformulees: {
    id: string;
    citation_modifiee: boolean;
    avant: MesureVersion;
    apres: MesureVersion;
  }[];
  nouvelles_sources: Source[];
  statut: { avant: Statut; apres: Statut; source: Source | null } | null;
};

export type VersionFiche = {
  version: number;
  date: string | null;
  motif: string | null;
  // Copie figée présente (historique/) ; sinon version connue par le journal seul
  conservee: boolean;
  // Copie présente mais illisible ou incohérente
  copie_en_defaut?: boolean;
  comparee_a: number | null;
  changements: Changements | null;
  statut?: Statut;
  mesures?: number;
};

export type Presence = { presente: boolean | null; page: number | null };

export type VersionDocument = Source & {
  remplace: string | null;
  // Texte versionné disponible (textes/ du dépôt de données)
  texte: boolean;
};

export type ParcoursMesure = {
  // Mesure de la fiche publiée (jamais masquée : retirée pour erreur, elle n'y est plus)
  mesure: MesureForme;
  premiere: string | null;
  page_premiere: number | null;
  // Texte d'une version antérieure absent : la citation y figurait peut-être déjà
  premiere_incertaine?: boolean;
  disparue: string | null;
  reapparue?: string | null;
  presences: Record<string, Presence>;
};

export type Programme = {
  titre: string;
  // De la plus ancienne à la plus récente (lignée « remplace »)
  versions: VersionDocument[];
  mesures: ParcoursMesure[];
};

export type Evolution = {
  candidat: string;
  nom_affiche: string;
  version: number;
  versions: VersionFiche[];
  programmes: Programme[];
};

// GET /api/presidentielle/evolution/{candidat}/comparaison?de=&a=
export type SegmentMots = { type: "egal" | "ajoute" | "retire"; texte: string };

export type BlocComparaison = {
  type: "ajoute" | "retire" | "modifie";
  page_avant: number | null;
  page_apres: number | null;
  avant: string | null;
  apres: string | null;
  // Différences mot pour mot d'un paragraphe modifié (null : paragraphe trop long)
  mots: SegmentMots[] | null;
};

export type Comparaison = {
  candidat: string;
  de: Source | null;
  a: Source | null;
  blocs: BlocComparaison[];
  inchanges: number;
  tronque: boolean;
};
