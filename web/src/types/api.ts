// Réponses du routeur et de nginx utilisées par l'interface (champs lus seulement)

export type Voice = {
  id: string;
  name: string;
  file: string;
  preview?: string;
  gender?: string;
  persona?: string;
  avatars?: string[];
  effect?: string;
};

export type Agent = {
  id: string;
  name: string;
  domain?: string;
  usage?: string;
  description?: string;
  instructions?: string;
};

export type Mode = {
  id: string;
  name: string;
  description?: string;
  usages: string[];
};

export type Settings = {
  voice?: string;
  model?: string;
  // Modèle de repli (Connexions)
  fallback?: string;
  project?: string;
  agent?: string | null;
  mode?: string | null;
};

export type Config = Record<string, unknown>;

export type NetState = {
  online: boolean;
  search?: boolean;
  searching?: boolean;
  sharing?: boolean;
};

export type WebSource = {
  n: number;
  title: string;
  url: string;
  domain: string;
  snippet?: string;
};

export type TurnWeb = {
  query?: string;
  offline?: boolean;
  sources?: WebSource[];
};

// Dernier tour préparé par le routeur (api/turn/last)
export type Turn = {
  at: number;
  agent?: string;
  notice?: string;
  projects: string[];
  sources: string[];
  skipped?: string[];
  code?: { lang: string; code: string }[];
  web?: TurnWeb;
};

export type AttachedDocument = {
  id: string;
  name: string;
  kind: string;
  tokens: number;
  voice: boolean;
};

export type ModelInfo = {
  name: string;
  label?: string;
  [key: string]: unknown;
};

// Veilles IA et météo du service antares-tasks (api/veille/latest, api/veille?date=,
// api/veille/vote, api/veille/idea/<id>/prompt) : contrat de la refonte (schéma 2).
// Passage ancien (schéma 1) : identifiants à null, champs neufs à leur valeur neutre.
export type VeilleVoteValue = "like" | "dislike";
export type VeilleLang = "fr" | "en" | "";

export type VeilleItem = {
  id: string | null;
  title: string;
  url: string;
  source: string;
  lang: VeilleLang;
  // Slug de catégorie, "" si inconnu
  category: string;
  sentence: string;
  // Extrait publié par le site (fiche de l'article) ; "" si absent
  summary: string;
  published_at: string | null;
  vote: VeilleVoteValue | null;
};

// Article non retenu par le modèle (onglet « Tous les articles », api/veille/others) :
// pas de phrase en français, score des votes
export type VeilleOther = VeilleItem & { id: string; score: number };

export type VeilleOthers = { day: string; items: VeilleOther[] };

export type VeilleIdea = {
  id: string | null;
  title: string;
  benefit: string;
  effort: "S" | "M" | "L";
  first_step: string;
  inspired_by: { id: string; title: string; url: string } | null;
  vote: VeilleVoteValue | null;
  has_prompt: boolean;
};

export type VeilleRun = {
  id: number;
  schema: 1 | 2;
  day: string;
  slot_at: string | null;
  started_at: string;
  finished_at: string;
  status: "done" | "failed";
  model: string;
  items: VeilleItem[];
  ideas: VeilleIdea[];
  errors: string[];
  // Passage demandé depuis l'interface (bouton « Nouveau passage »)
  manual: boolean;
};

// Passage manuel (api/veille/run) : idle (aucune demande), pending (déposée), running,
// done, failed, expired (jamais prise : service arrêté)
export type VeilleRunState =
  "idle" | "pending" | "running" | "done" | "failed" | "expired";

export type VeilleRunStatus = {
  state: VeilleRunState;
  request_id: number | null;
  requested_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  run_id: number | null;
  // Secondes avant qu'un nouveau passage manuel soit permis
  retry_after: number;
};

export type VeilleWeatherKey =
  | "clear"
  | "partly-cloudy"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "storm"
  | "unknown";

export type VeilleHour = {
  at: string;
  temperature: number | null;
  code: number | null;
  key: VeilleWeatherKey;
  rain: number | null;
  is_day: boolean;
};

export type VeilleWeather = {
  day: string;
  label: string;
  text: string;
  fetched_at: string;
  condition: {
    code: number;
    key: VeilleWeatherKey;
    label: string;
    is_day: boolean;
  } | null;
  current: { temperature: number | null; wind: number | null } | null;
  today: {
    min: number | null;
    max: number | null;
    rain: number | null;
    wind: number | null;
  } | null;
  hours: VeilleHour[];
};

export type VeilleCategory = { slug: string; label: string };

// Créneau manqué (service arrêté) ou interrompu sans passage
export type VeilleMissed = { slot_at: string; status: "missed" | "failed" };

export type VeilleLatest = {
  run: VeilleRun | null;
  weather: VeilleWeather | null;
  categories: VeilleCategory[];
  last_success_at: string | null;
  missed: VeilleMissed[];
  days: string[];
};

export type VeilleDay = {
  weather: VeilleWeather | null;
  runs: VeilleRun[];
  missed: VeilleMissed[];
  categories: VeilleCategory[];
};

export type VeilleVote = {
  kind: "article" | "idea";
  id: string;
  value: VeilleVoteValue | "none";
  voted_at: string | null;
};

export type VeilleIdeaPrompt = {
  idea_id: string;
  prompt: string;
  model: string;
  created_at: string;
  cached: boolean;
};

// Sources de la veille (api/veille/sources) : fournies par tasks.yaml (désactivables)
// et ajoutées depuis l'interface (flux, ou sujet = recherche Google News)
export type VeilleSourceKind = "feed" | "search";

export type VeilleBuiltinSource = {
  name: string;
  url: string;
  lang: string;
  category: string;
  filter_keywords: boolean;
  enabled: boolean;
  favorite: boolean;
};

export type VeilleCustomSource = {
  id: number;
  kind: VeilleSourceKind;
  name: string;
  url: string;
  query: string;
  lang: "fr" | "en";
  category: string;
  filter_keywords: boolean;
  created_at: string;
  favorite: boolean;
};

export type VeilleSources = {
  builtin: VeilleBuiltinSource[];
  custom: VeilleCustomSource[];
  categories: VeilleCategory[];
  max_custom: number;
  max_favorites: number;
};

// Sources privilégiées (api/veille/sources/favorites) : 3 places garanties chacune
export type VeilleFavorites = { names: string[]; max_favorites: number };

export type VeilleSourceInput = {
  kind: VeilleSourceKind;
  name: string;
  url: string;
  query: string;
  lang: "fr" | "en";
  category: string;
  filter_keywords: boolean;
};

export type VeilleSourceProbe = {
  name: string;
  url: string;
  articles: number;
  recent: number;
  latest: { title: string; published_at: string }[];
};

// Traduction en français d'un article (api/veille/article/<id>/translate)
export type VeilleTranslation = {
  article_id: string;
  title: string;
  summary: string;
  model: string;
  created_at: string;
  cached: boolean;
};

// Statistiques de la veille (api/veille/stats?days=7|30|365) : goûts (votes) et choix de
// l'IA (résumés quotidiens), pourcentages arrondis à 0,1 ; null si rien à diviser
export type VeilleStatsCategory = {
  slug: string;
  label: string;
  count: number;
  share: number | null;
};

export type VeilleStats = {
  days: number;
  since: string;
  until: string;
  summary: {
    likes: number;
    dislikes: number;
    agreement: number | null;
    agreement_votes: number;
    missed_likes: number;
    featured: number;
    collected: number;
    ideas_interested: number;
    ideas_rejected: number;
  };
  tastes: {
    categories: (VeilleStatsCategory & { dislikes: number })[];
    sources: {
      name: string;
      likes: number;
      dislikes: number;
      like_rate: number | null;
    }[];
    words: { word: string; count: number }[];
  };
  ai: {
    categories: VeilleStatsCategory[];
    sources: {
      name: string;
      featured: number;
      share: number | null;
      collected: number;
      selection_rate: number | null;
    }[];
  };
  timeline: {
    day: string;
    featured: Record<string, number>;
    agree_likes: number;
    agree_dislikes: number;
    missed_likes: number;
  }[];
};
