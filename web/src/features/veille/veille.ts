// Veille IA et météo : logique pure (pastille, liens sûrs, contrôle des réponses du
// routeur, filtres, votes, dessin de la météo, copie, heures en français et en heure de
// Paris). Testée par tests/unit/veille.test.ts.
import type {
  VeilleCategory,
  VeilleDay,
  VeilleHour,
  VeilleIdea,
  VeilleItem,
  VeilleLang,
  VeilleLatest,
  VeilleMissed,
  VeilleOther,
  VeilleOthers,
  VeilleRun,
  VeilleRunState,
  VeilleRunStatus,
  VeilleSourceInput,
  VeilleSourceProbe,
  VeilleVoteValue,
  VeilleWeather,
  VeilleWeatherKey,
} from "@/types/api";

export const TIME_ZONE = "Europe/Paris";
// Nom du bouton et titre de la fenêtre
export const VEILLE_LABEL = "Veille IA et météo";

// Instant lisible (ISO 8601) ou null : une valeur corrompue du stockage compte pour absente
export function parseStamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

// Pastille : dernier passage (réussi ou en échec) plus récent que la dernière ouverture.
// Jamais ouverte, ou stockage indisponible : allumée dès qu'un passage existe.
export function hasNews(
  latestAt: string | null | undefined,
  lastOpened: string | null | undefined,
): boolean {
  const latest = parseStamp(latestAt);
  if (latest === null) return false;
  const opened = parseStamp(lastOpened);
  return opened === null || latest > opened;
}

// Date d'ouverture à retenir : maintenant, ou l'heure du passage s'il est plus récent
// (horloges du poste et du serveur décalées)
export function openedStamp(now: Date, latestAt: string | null | undefined) {
  const latest = parseStamp(latestAt);
  const time = Math.max(now.getTime(), latest ?? 0);
  return new Date(time).toISOString();
}

// Adresse affichable en lien : http et https seulement (sinon texte simple)
export function safeHref(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  // Schéma vérifié ci-dessus : seul un reste d'adresse invalide peut encore échouer
  try {
    return new URL(trimmed).href;
  } catch {
    return null;
  }
}

// --- Contrôle des réponses ------------------------------------------------------------

type Json = Record<string, unknown>;

const ID = /^[0-9a-f]{16}$/;
const WEATHER_KEYS: readonly VeilleWeatherKey[] = [
  "clear",
  "partly-cloudy",
  "cloudy",
  "fog",
  "drizzle",
  "rain",
  "snow",
  "storm",
  "unknown",
];

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const id = (value: unknown): string | null =>
  typeof value === "string" && ID.test(value) ? value : null;
const vote = (value: unknown): VeilleVoteValue | null =>
  value === "like" || value === "dislike" ? value : null;
const lang = (value: unknown): VeilleLang =>
  value === "fr" || value === "en" ? value : "";

export function weatherKey(value: unknown): VeilleWeatherKey {
  return WEATHER_KEYS.find((key) => key === value) ?? "unknown";
}

function parseItem(value: unknown): VeilleItem | null {
  if (!isObject(value) || !text(value.title)) return null;
  return {
    id: id(value.id),
    title: text(value.title),
    url: text(value.url),
    source: text(value.source),
    lang: lang(value.lang),
    category: text(value.category),
    sentence: text(value.sentence),
    summary: text(value.summary),
    published_at:
      parseStamp(text(value.published_at)) === null
        ? null
        : text(value.published_at),
    vote: vote(value.vote),
  };
}

function parseInspiration(value: unknown): VeilleIdea["inspired_by"] {
  if (!isObject(value) || !text(value.title)) return null;
  return {
    id: id(value.id) ?? "",
    title: text(value.title),
    url: text(value.url),
  };
}

function parseIdea(value: unknown): VeilleIdea | null {
  if (!isObject(value) || !text(value.title)) return null;
  const effort =
    value.effort === "S" || value.effort === "L" ? value.effort : "M";
  return {
    id: id(value.id),
    title: text(value.title),
    benefit: text(value.benefit),
    effort,
    first_step: text(value.first_step),
    inspired_by: parseInspiration(value.inspired_by),
    vote: vote(value.vote),
    has_prompt: value.has_prompt === true,
  };
}

export function parseRun(value: unknown): VeilleRun | null {
  if (!isObject(value) || parseStamp(text(value.finished_at)) === null)
    return null;
  const items = list(value.items).flatMap((i) => parseItem(i) ?? []);
  const ideas = list(value.ideas).flatMap((i) => parseIdea(i) ?? []);
  // Schéma annoncé par le routeur ; à défaut, déduit (un objet sans identifiant : 1)
  const schema =
    value.schema === 1 || value.schema === 2
      ? value.schema
      : [...items, ...ideas].some((o) => o.id === null)
        ? 1
        : 2;
  return {
    id: typeof value.id === "number" ? value.id : 0,
    schema,
    day: text(value.day),
    slot_at: text(value.slot_at) || null,
    started_at: text(value.started_at),
    finished_at: text(value.finished_at),
    status: value.status === "failed" ? "failed" : "done",
    model: text(value.model),
    items,
    ideas,
    errors: list(value.errors).filter(
      (e): e is string => typeof e === "string",
    ),
    manual: value.manual === true,
  };
}

// Réponse de api/veille/others ; articles sans identifiant écartés (vote impossible)
export function parseOthers(value: unknown): VeilleOthers | null {
  if (!isObject(value) || !Array.isArray(value.items)) return null;
  return {
    day: text(value.day),
    items: value.items.flatMap((raw) => {
      const item = parseItem(raw);
      if (!item?.id || !isObject(raw)) return [];
      return [{ ...item, id: item.id, score: num(raw.score) ?? 0 }];
    }),
  };
}

const RUN_STATES: readonly VeilleRunState[] = [
  "idle",
  "pending",
  "running",
  "done",
  "failed",
  "expired",
];

// Réponse de api/veille/run (GET ou POST), ou null si sa forme est inattendue
export function parseRunStatus(value: unknown): VeilleRunStatus | null {
  if (!isObject(value)) return null;
  const state = RUN_STATES.find((s) => s === value.state);
  if (!state) return null;
  return {
    state,
    request_id: num(value.request_id),
    requested_at: text(value.requested_at) || null,
    started_at: text(value.started_at) || null,
    finished_at: text(value.finished_at) || null,
    run_id: num(value.run_id),
    retry_after: Math.max(0, num(value.retry_after) ?? 0),
  };
}

function parseHour(value: unknown): VeilleHour | null {
  if (!isObject(value) || parseStamp(text(value.at)) === null) return null;
  return {
    at: text(value.at),
    temperature: num(value.temperature),
    code: num(value.code),
    key: weatherKey(value.key),
    rain: num(value.rain),
    is_day: value.is_day !== false,
  };
}

export function parseWeather(value: unknown): VeilleWeather | null {
  if (!isObject(value) || !text(value.text)) return null;
  const condition = isObject(value.condition) ? value.condition : null;
  const current = isObject(value.current) ? value.current : null;
  const today = isObject(value.today) ? value.today : null;
  return {
    day: text(value.day),
    label: text(value.label),
    text: text(value.text),
    fetched_at: text(value.fetched_at),
    condition: condition
      ? {
          code: num(condition.code) ?? -1,
          key: weatherKey(condition.key),
          label: text(condition.label),
          is_day: condition.is_day !== false,
        }
      : null,
    current: current
      ? { temperature: num(current.temperature), wind: num(current.wind) }
      : null,
    today: today
      ? {
          min: num(today.min),
          max: num(today.max),
          rain: num(today.rain),
          wind: num(today.wind),
        }
      : null,
    hours: list(value.hours).flatMap((h) => parseHour(h) ?? []),
  };
}

function parseCategories(value: unknown): VeilleCategory[] {
  return list(value).flatMap((c) =>
    isObject(c) && text(c.slug)
      ? [{ slug: text(c.slug), label: text(c.label) || text(c.slug) }]
      : [],
  );
}

function parseMissed(value: unknown): VeilleMissed[] {
  return list(value).flatMap((m) =>
    isObject(m) && parseStamp(text(m.slot_at)) !== null
      ? [
          {
            slot_at: text(m.slot_at),
            status: m.status === "failed" ? "failed" : "missed",
          } as VeilleMissed,
        ]
      : [],
  );
}

// Réponse de api/veille/latest, ou null si sa forme est inattendue (simulateur : `[]`)
export function parseLatest(value: unknown): VeilleLatest | null {
  if (!isObject(value) || !("run" in value)) return null;
  return {
    run: parseRun(value.run),
    weather: parseWeather(value.weather),
    categories: parseCategories(value.categories),
    last_success_at: text(value.last_success_at) || null,
    missed: parseMissed(value.missed),
    days: list(value.days).filter(
      (d): d is string =>
        typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d),
    ),
  };
}

export function parseDay(value: unknown): VeilleDay | null {
  if (!isObject(value) || !Array.isArray(value.runs)) return null;
  return {
    weather: parseWeather(value.weather),
    runs: value.runs.flatMap((r) => parseRun(r) ?? []),
    missed: parseMissed(value.missed),
    categories: parseCategories(value.categories),
  };
}

// --- Catégories, sources, nouveautés ----------------------------------------------------

// Couleur de catégorie : déclarée dans veille.css pour ces slugs, neutre sinon
export const KNOWN_CATEGORIES = [
  "ia",
  "cloud",
  "dev",
  "securite",
  "materiel",
  "informatique",
] as const;

export function categoryColor(slug: string): string {
  return (KNOWN_CATEGORIES as readonly string[]).includes(slug)
    ? slug
    : "autre";
}

// Libellé d'une catégorie : celui du routeur, sinon le slug, sinon « Autre »
export function categoryLabel(
  slug: string,
  categories: readonly VeilleCategory[],
): string {
  return categories.find((c) => c.slug === slug)?.label ?? (slug || "Autre");
}

export type CategoryCount = { slug: string; label: string; count: number };

// Catégories présentes dans les articles, dans l'ordre du routeur puis par apparition
export function categoriesOf(
  items: readonly VeilleItem[],
  categories: readonly VeilleCategory[],
): CategoryCount[] {
  const counts = new Map<string, number>();
  for (const item of items)
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  const known = categories.map((c) => c.slug);
  return [...counts.keys()]
    .sort((a, b) => {
      const ia = known.indexOf(a);
      const ib = known.indexOf(b);
      return (ia < 0 ? known.length : ia) - (ib < 0 ? known.length : ib);
    })
    .map((slug) => ({
      slug,
      label: categoryLabel(slug, categories),
      count: counts.get(slug) ?? 0,
    }));
}

// Sources présentes, ordre alphabétique français
export function sourcesOf(items: readonly VeilleItem[]): string[] {
  return [...new Set(items.map((i) => i.source).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "fr", { sensitivity: "base" }),
  );
}

// Pastille de source : initiales des deux premiers mots, ou deux premières lettres
export function sourceInitials(source: string): string {
  const words = source.match(/[\p{L}\p{N}]+/gu) ?? [];
  const [first, second] = words;
  if (!first) return "?";
  const letters = second
    ? `${first.charAt(0)}${second.charAt(0)}`
    : first.slice(0, 2);
  return letters.toUpperCase();
}

// Badge « Nouveau » : passage terminé après l'ouverture précédente (lue avant markOpened)
export function isNewRun(
  run: Pick<VeilleRun, "finished_at"> | null | undefined,
  previousOpened: string | null | undefined,
): boolean {
  return hasNews(run?.finished_at, previousOpened);
}

// --- Journée : passages fusionnés -------------------------------------------------------

export type DayEntry<T> = { value: T; runFinishedAt: string };

// Articles (ou idées) des passages d'un jour, le plus récent d'abord, sans doublon
// (même identifiant : la version la plus récente) ; objets sans identifiant gardés
function merged<T extends { id: string | null }>(
  runs: readonly VeilleRun[],
  pick: (run: VeilleRun) => readonly T[],
): DayEntry<T>[] {
  const ordered = [...runs].sort(
    (a, b) =>
      (parseStamp(b.finished_at) ?? 0) - (parseStamp(a.finished_at) ?? 0) ||
      b.id - a.id,
  );
  const known = new Set<string>();
  const found: DayEntry<T>[] = [];
  for (const run of ordered)
    for (const value of pick(run)) {
      if (value.id) {
        if (known.has(value.id)) continue;
        known.add(value.id);
      }
      found.push({ value, runFinishedAt: run.finished_at });
    }
  return found;
}

export const dayItems = (runs: readonly VeilleRun[]) =>
  merged(runs, (run) => run.items);
export const dayIdeas = (runs: readonly VeilleRun[]) =>
  merged(runs, (run) => run.ideas);

// Dernier passage du jour (heure de fin), réussi ou non
export function lastRun(runs: readonly VeilleRun[]): VeilleRun | undefined {
  return [...runs].sort(
    (a, b) =>
      (parseStamp(b.finished_at) ?? 0) - (parseStamp(a.finished_at) ?? 0) ||
      b.id - a.id,
  )[0];
}

// « 3 passages · dernier à 13:05 » ; « Aucun passage ce jour »
export function runsLabel(runs: readonly VeilleRun[]): string {
  const last = lastRun(runs);
  if (!last) return "Aucun passage ce jour";
  const count = `${runs.length} passage${runs.length > 1 ? "s" : ""}`;
  const failed = last.status === "failed" ? " (en échec)" : "";
  return `${count} · dernier à ${formatTime(last.finished_at)}${failed}`;
}

// --- Tous les articles ------------------------------------------------------------------

export type OtherOrder = "score" | "date";
// Lignes affichées d'un coup, puis « Afficher 50 de plus »
export const OTHERS_PAGE = 50;

// Pertinence : score des votes (ordre du routeur), puis date ; date : plus récent d'abord
export function sortOthers(
  items: readonly VeilleOther[],
  order: OtherOrder,
): VeilleOther[] {
  const date = (item: VeilleOther) => parseStamp(item.published_at) ?? 0;
  return [...items].sort((a, b) =>
    order === "date"
      ? date(b) - date(a) || b.score - a.score
      : b.score - a.score || date(b) - date(a),
  );
}

// --- Passage manuel ---------------------------------------------------------------------

// Demande en attente ou en cours : bouton désactivé, état relu toutes les 5 s
export const RUN_POLL_MS = 5000;

export function runBusy(status: VeilleRunStatus | null): boolean {
  return status?.state === "pending" || status?.state === "running";
}

// Message de fin d'un passage manuel ; null tant qu'il n'est pas fini
export function runOutcome(
  state: VeilleRunState,
  added: number,
): string | null {
  if (state === "done")
    return added > 0
      ? `Nouveau passage terminé : ${added} article${added > 1 ? "s" : ""} ajouté${added > 1 ? "s" : ""}`
      : "Nouveau passage terminé : aucun article nouveau";
  if (state === "failed") return "Nouveau passage en échec : voir les erreurs";
  if (state === "expired")
    return "Passage non lancé : le service antares-tasks ne répond pas";
  return null;
}

// --- Filtres ----------------------------------------------------------------------------

export type ArticleFilters = {
  // Slugs retenus ; vide : toutes
  categories: string[];
  // Source exacte ; vide : toutes
  source: string;
  lang: VeilleLang;
  likedOnly: boolean;
  query: string;
};

export const NO_FILTERS: ArticleFilters = {
  categories: [],
  source: "",
  lang: "",
  likedOnly: false,
  query: "",
};

// --- Sources ----------------------------------------------------------------------

export const EMPTY_SOURCE: VeilleSourceInput = {
  kind: "feed",
  name: "",
  url: "",
  query: "",
  lang: "fr",
  category: "",
  filter_keywords: false,
};

// Nom de domaine sans « www. » (affiché sous le nom d'une source) ; "" si illisible
export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Formulaire prêt : adresse http(s) pour un flux, deux caractères au moins pour un sujet
export function sourceReady(input: VeilleSourceInput): boolean {
  return input.kind === "feed"
    ? /^https?:\/\/\S+\.\S+/i.test(input.url.trim())
    : input.query.trim().length >= 2;
}

export function probeSummary(probe: VeilleSourceProbe): string {
  const total = `${probe.articles} article${probe.articles > 1 ? "s" : ""}`;
  return `${total}, dont ${probe.recent} de moins de 48 h`;
}

// Sources dont le nom ou l'adresse contient chaque mot de la recherche
export function filterSources<T extends { name: string; url: string }>(
  sources: readonly T[],
  query: string,
): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return sources.filter((source) => {
    const text = fold(`${source.name} ${source.url}`);
    return words.every((word) => text.includes(word));
  });
}

// Texte comparable : minuscules, sans accents
export function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

// Filtres combinés (ET) ; recherche : chaque mot dans le titre, la phrase, l'extrait ou
// la source
export function filterItems<T extends VeilleItem>(
  items: readonly T[],
  filters: ArticleFilters,
  voteOf: (item: T) => VeilleVoteValue | null = (item) => item.vote,
): T[] {
  const words = fold(filters.query).split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (
      filters.categories.length > 0 &&
      !filters.categories.includes(item.category)
    )
      return false;
    if (filters.source && item.source !== filters.source) return false;
    if (filters.lang && item.lang !== filters.lang) return false;
    if (filters.likedOnly && voteOf(item) !== "like") return false;
    if (words.length === 0) return true;
    const haystack = fold(
      `${item.title} ${item.sentence} ${item.summary} ${item.source}`,
    );
    return words.every((word) => haystack.includes(word));
  });
}

// Nombre de filtres actifs (bouton « Filtres » sur petit écran)
export function activeFilters(filters: ArticleFilters): number {
  return (
    (filters.categories.length > 0 ? 1 : 0) +
    (filters.source ? 1 : 0) +
    (filters.lang ? 1 : 0) +
    (filters.likedOnly ? 1 : 0) +
    (filters.query.trim() ? 1 : 0)
  );
}

// « 12 articles sur 20 », « 1 article sur 20 », « 20 articles »
export function countLabel(shown: number, total: number): string {
  const noun = (n: number) => (n > 1 ? "articles" : "article");
  return shown === total
    ? `${total} ${noun(total)}`
    : `${shown} ${noun(shown)} sur ${total}`;
}

// --- Votes ------------------------------------------------------------------------------

export type VoteKind = "article" | "idea";

// Clé locale d'un vote (un article et une idée peuvent partager un identifiant)
export const voteKey = (kind: VoteKind, targetId: string) =>
  `${kind}:${targetId}`;

// Valeur à envoyer après un clic : un second clic sur la valeur en place l'annule
export function nextVote(
  current: VeilleVoteValue | null,
  clicked: VeilleVoteValue,
): VeilleVoteValue | "none" {
  return current === clicked ? "none" : clicked;
}

// --- Météo ------------------------------------------------------------------------------

export type WeatherArtId =
  | "clear-day"
  | "clear-night"
  | "partly-cloudy-day"
  | "partly-cloudy-night"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "storm"
  | "unknown";

// Dessin d'un temps : soleil et éclaircies ont une version de nuit
export function weatherArt(
  key: VeilleWeatherKey,
  isDay: boolean,
): WeatherArtId {
  if (key === "clear") return isDay ? "clear-day" : "clear-night";
  if (key === "partly-cloudy")
    return isDay ? "partly-cloudy-day" : "partly-cloudy-night";
  return key;
}

const WEATHER_LABELS: Record<VeilleWeatherKey, string> = {
  clear: "Ensoleillé",
  "partly-cloudy": "Éclaircies",
  cloudy: "Nuageux",
  fog: "Brouillard",
  drizzle: "Bruine",
  rain: "Pluie",
  snow: "Neige",
  storm: "Orage",
  unknown: "Temps inconnu",
};

// Libellé d'une heure de la frise (le routeur ne le fournit que pour l'état actuel)
export function weatherLabel(key: VeilleWeatherKey, isDay = true): string {
  if (key === "clear" && !isDay) return "Ciel dégagé";
  return WEATHER_LABELS[key];
}

// « 12 °C » ; valeur absente : « – »
export function degrees(value: number | null | undefined): string {
  return typeof value === "number" ? `${Math.round(value)} °C` : "–";
}

// --- Copie ------------------------------------------------------------------------------

export type CopyResult = "clipboard" | "fallback" | "manual";

type CopyEnv = {
  clipboard?: { writeText(text: string): Promise<void> } | undefined;
  doc?: Document | undefined;
  // Élément où poser la zone de texte de repli (fenêtre ouverte : focus piégé)
  container?: HTMLElement | null | undefined;
};

// Copie : presse-papiers, sinon zone de texte en lecture seule sélectionnée et
// execCommand("copy"), sinon « manual » (l'interface invite à sélectionner puis Ctrl+C)
export async function copyText(
  text: string,
  env: CopyEnv,
): Promise<CopyResult> {
  if (env.clipboard) {
    try {
      await env.clipboard.writeText(text);
      return "clipboard";
    } catch {
      // Refus (permission, contexte non sûr) : repli ci-dessous
    }
  }
  const doc = env.doc;
  if (!doc) return "manual";
  const area = doc.createElement("textarea");
  area.value = text;
  area.readOnly = true;
  area.className = "veille-copy-fallback";
  (env.container ?? doc.body).appendChild(area);
  try {
    area.select();
    return doc.execCommand("copy") ? "fallback" : "manual";
  } catch {
    return "manual";
  } finally {
    area.remove();
  }
}

// --- Heures -----------------------------------------------------------------------------

const TIME = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});
const HOUR = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIME_ZONE,
  hour: "numeric",
});
const DATE_TIME = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const SHORT_DATE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
});
const DAY = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

// « 13:00 » en heure de Paris
export function formatTime(iso: string): string {
  const time = parseStamp(iso);
  return time === null ? "" : TIME.format(time);
}

// « 13 h » en heure de Paris (frise météo)
export function formatHour(iso: string): string {
  const time = parseStamp(iso);
  return time === null ? "" : HOUR.format(time).replace(/\s*h$/, " h");
}

// « lun. 16 nov., 13:00 » en heure de Paris
export function formatDateTime(iso: string): string {
  const time = parseStamp(iso);
  return time === null ? "" : DATE_TIME.format(time);
}

// « lundi 16 novembre 2026 » pour un jour AAAA-MM-JJ (déjà local)
export function formatDay(day: string): string {
  const time = parseStamp(`${day}T12:00:00Z`);
  return time === null ? day : DAY.format(time);
}

// Heure de publication relative : « à l'instant », « il y a 25 min », « il y a 3 h »,
// « hier », sinon « 14 nov. »
export function relativeTime(iso: string | null, now: Date): string {
  const time = parseStamp(iso);
  if (time === null) return "";
  const minutes = Math.floor((now.getTime() - time) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  if (hours < 48) return "hier";
  return SHORT_DATE.format(time);
}
