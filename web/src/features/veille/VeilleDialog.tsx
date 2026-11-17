// Fenêtre Veille IA et météo, plein écran : en-tête (passages du jour, jour, Nouveau
// passage, Statistiques, Sources, Fermer), grande météo, deux onglets : « À la une » (articles de tous
// les passages du jour fusionnés, le plus récent d'abord, idées pour Antares avec leur
// prompt, erreurs du dernier passage) et « Tous les articles » (lus mais non retenus par
// le modèle). Un clic sur un article ouvre sa fiche. Contenu des flux rendu en texte
// React (jamais en HTML) ; liens http(s) seulement, ouverts dans un nouvel onglet. Votes
// et étoiles optimistes : affichés tout de suite, rétablis avec un message court si le
// routeur refuse.
import {
  ChartPie,
  Lightbulb,
  List,
  Newspaper,
  RefreshCw,
  Rss,
  X,
} from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import { getJson } from "@/lib/api";
import type {
  VeilleCategory,
  VeilleDay,
  VeilleIdea,
  VeilleIdeaPrompt,
  VeilleItem,
  VeilleLatest,
  VeilleOther,
  VeilleRun,
  VeilleRunStatus,
  VeilleVoteValue,
  VeilleWeather,
} from "@/types/api";

import {
  loadFavorites,
  loadIdeaPrompt,
  loadOthers,
  loadRunStatus,
  requestRun,
  retryable,
  sendVote,
  setFavorite,
} from "./api";
import { ArticleCard } from "./ArticleCard";
import { ArticleDialog } from "./ArticleDialog";
import { IdeaCard } from "./IdeaCard";
import { IdeaPromptDialog, type PromptState } from "./IdeaPromptDialog";
import { OtherList } from "./OtherList";
import { SourcesDialog } from "./SourcesDialog";
import { StatsDialog } from "./StatsDialog";
import { markOpened, refreshLatest, veilleStore } from "./state";
import {
  type ArticleFilters,
  categoryLabel,
  countLabel,
  dayIdeas,
  dayItems,
  filterItems,
  formatDateTime,
  formatDay,
  formatTime,
  hasNews,
  lastRun,
  nextVote,
  NO_FILTERS,
  type OtherOrder,
  parseDay,
  RUN_POLL_MS,
  runBusy,
  runOutcome,
  runsLabel,
  sortOthers,
  VEILLE_LABEL,
  type VoteKind,
  voteKey,
} from "./veille";
import { VeilleFilters } from "./VeilleFilters";
import { WeatherPanel } from "./WeatherPanel";
import "./veille.css";

type View = {
  day: string;
  runs: VeilleRun[];
  weather: VeilleWeather | null;
  categories: VeilleCategory[];
};

type Tab = "featured" | "others";
// Articles non retenus du jour affiché : null pendant le chargement
type Others = { day: string; items: VeilleOther[] | null; error: string };

type Votable = { id: string | null; vote: VeilleVoteValue | null };

const NOTICE_MS = 4000;

async function loadDay(day: string): Promise<VeilleDay | null> {
  try {
    return parseDay(
      await getJson(`api/veille?date=${encodeURIComponent(day)}`),
    );
  } catch {
    return null;
  }
}

// Vue d'un jour : ses passages (au moins le dernier passage connu s'il en fait partie)
async function buildView(
  day: string,
  latest: VeilleLatest | null,
): Promise<View> {
  const loaded = await loadDay(day);
  const known = latest?.run?.day === day ? latest.run : null;
  return {
    day,
    runs: loaded?.runs.length ? loaded.runs : known ? [known] : [],
    weather: loaded ? loaded.weather : known ? (latest?.weather ?? null) : null,
    categories: loaded?.categories.length
      ? loaded.categories
      : (latest?.categories ?? []),
  };
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function VeilleDialog() {
  const latest = useStore(veilleStore, (s) => s.latest);
  // Ouverture précédente, lue avant markOpened() : badge « Nouveau »
  const [previousOpened] = useState(() => veilleStore.getState().lastOpened);
  const [now] = useState(() => new Date());
  const [view, setView] = useState<View | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("featured");
  // Passage affiché : rang dans la journée, -1 pour le dernier, « day » pour toute la
  // journée (passages fusionnés sans doublon)
  const [position, setPosition] = useState<number | "day">(-1);
  const [filters, setFilters] = useState<ArticleFilters>(NO_FILTERS);
  const [otherFilters, setOtherFilters] = useState<ArticleFilters>(NO_FILTERS);
  const [otherOrder, setOtherOrder] = useState<OtherOrder>("score");
  const [others, setOthers] = useState<Others | null>(null);
  const [detail, setDetail] = useState<VeilleItem | null>(null);
  // Sources privilégiées ; null : indisponibles (étoile masquée)
  const [favorites, setFavorites] = useState<Set<string> | null>(null);
  const [runStatus, setRunStatus] = useState<VeilleRunStatus | null>(null);
  const runTimer = useRef<number | undefined>(undefined);
  // Passage manuel suivi par cette fenêtre (demandé ici, ou en cours à l'ouverture)
  const tracking = useRef(false);
  const mounted = useRef(true);
  const [votes, setVotes] = useState<Record<string, VeilleVoteValue | null>>(
    {},
  );
  const [notice, setNotice] = useState("");
  const [prompt, setPrompt] = useState<{
    idea: VeilleIdea;
    state: PromptState;
  } | null>(null);
  const prompts = useRef<Record<string, VeilleIdeaPrompt>>({});
  const noticeTimer = useRef<number | undefined>(undefined);
  const frame = useRef<HTMLDivElement>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const header = useRef<HTMLElement>(null);

  // Ouverture et fermeture notées : la pastille s'éteint
  useEffect(() => {
    mounted.current = true;
    markOpened();
    return () => {
      mounted.current = false;
      markOpened();
      window.clearTimeout(noticeTimer.current);
      window.clearTimeout(runTimer.current);
    };
  }, []);

  useEffect(() => {
    void (async () => {
      const current = latest ?? (await refreshLatest());
      const day = current?.run?.day;
      const next = day ? await buildView(day, current) : null;
      if (!mounted.current) return;
      setView(next);
      setPosition(-1);
      setLoading(false);
      markOpened();
      if (next) void fetchOthers(next.day);
    })();
    void (async () => {
      try {
        const loaded = await loadFavorites();
        if (mounted.current) setFavorites(new Set(loaded.names));
      } catch {
        // Étoile masquée : la veille reste lisible
      }
    })();
    void (async () => {
      try {
        const status = await loadRunStatus();
        if (!mounted.current) return;
        setRunStatus(status);
        if (runBusy(status)) {
          tracking.current = true;
          scheduleRunPoll();
        }
      } catch {
        // Bouton « Nouveau passage » laissé actif : le routeur répondra au clic
      }
    })();
    // Vue construite à l'ouverture seulement : un relevé périodique ne la déplace pas
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hauteur de l'en-tête collant : la barre de filtres se colle juste dessous (variable
  // CSS posée par CSSOM, autorisée par la CSP)
  useLayoutEffect(() => {
    const head = header.current;
    const root = frame.current;
    if (!head || !root || typeof ResizeObserver === "undefined") return;
    const apply = () =>
      root.style.setProperty("--veille-header-h", `${head.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(head);
    return () => observer.disconnect();
  }, []);

  async function fetchOthers(day: string) {
    setOthers({ day, items: null, error: "" });
    try {
      const loaded = await loadOthers(day);
      if (mounted.current)
        setOthers((now) =>
          now?.day === day ? { day, items: loaded.items, error: "" } : now,
        );
    } catch (error) {
      if (mounted.current)
        setOthers((now) =>
          now?.day === day ? { day, items: [], error: errorText(error) } : now,
        );
    }
  }

  async function showDay(day: string) {
    setLoading(true);
    const next = await buildView(day, latest);
    if (!mounted.current) return;
    setView(next);
    setPosition(-1);
    setLoading(false);
    void fetchOthers(day);
  }

  // --- Passage manuel -------------------------------------------------------------

  function scheduleRunPoll() {
    window.clearTimeout(runTimer.current);
    runTimer.current = window.setTimeout(() => void pollRun(), RUN_POLL_MS);
  }

  async function pollRun() {
    let status: VeilleRunStatus;
    try {
      status = await loadRunStatus();
    } catch {
      if (mounted.current) scheduleRunPoll();
      return;
    }
    if (!mounted.current) return;
    setRunStatus(status);
    if (runBusy(status)) {
      scheduleRunPoll();
      return;
    }
    if (!tracking.current) return;
    tracking.current = false;
    // Passage fini : relecture du jour, articles ajoutés comptés
    const before = new Set(
      (view?.runs ?? []).flatMap((r) => r.items.map((i) => i.id)),
    );
    const current = await refreshLatest();
    const day = current?.run?.day ?? view?.day;
    if (!day || !mounted.current) return;
    const next = await buildView(day, current);
    if (!mounted.current) return;
    setView(next);
    // Le passage qui vient de finir
    setPosition(-1);
    void fetchOthers(day);
    const added = dayItems(next.runs).filter(
      (entry) => !before.has(entry.value.id),
    ).length;
    const message = runOutcome(status.state, added);
    if (message) showNotice(message);
  }

  async function startRun() {
    try {
      const status = await requestRun();
      setRunStatus(status);
      tracking.current = true;
      showNotice("Nouveau passage demandé : 30 à 60 s");
      scheduleRunPoll();
    } catch (error) {
      showNotice(`Passage non lancé : ${errorText(error)}`);
    }
  }

  // --- Sources privilégiées -------------------------------------------------------

  async function toggleFavorite(source: string) {
    if (!favorites) return;
    const was = favorites.has(source);
    const apply = (on: boolean) =>
      setFavorites((all) => {
        const next = new Set(all ?? []);
        if (on) next.add(source);
        else next.delete(source);
        return next;
      });
    apply(!was);
    try {
      await setFavorite(source, !was);
      showNotice(
        was
          ? `${source} n'est plus privilégiée`
          : `${source} privilégiée : 3 places garanties au prochain passage`,
      );
    } catch (error) {
      apply(was);
      showNotice(`Étoile non enregistrée : ${errorText(error)}`);
    }
  }

  function showNotice(message: string) {
    window.clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = window.setTimeout(() => setNotice(""), NOTICE_MS);
  }

  function voteOf(kind: VoteKind, target: Votable): VeilleVoteValue | null {
    if (!target.id) return null;
    const key = voteKey(kind, target.id);
    return key in votes ? (votes[key] ?? null) : target.vote;
  }

  // Vote optimiste ; vrai si le routeur l'a enregistré
  async function vote(
    kind: VoteKind,
    target: Votable,
    clicked: VeilleVoteValue,
  ): Promise<VeilleVoteValue | "none" | null> {
    if (!target.id) return null;
    const key = voteKey(kind, target.id);
    const current = voteOf(kind, target);
    const next = nextVote(current, clicked);
    setVotes((all) => ({ ...all, [key]: next === "none" ? null : next }));
    try {
      await sendVote(kind, target.id, next);
      return next;
    } catch (error) {
      setVotes((all) => ({ ...all, [key]: current }));
      showNotice(`Vote non enregistré : ${errorText(error)}`);
      return null;
    }
  }

  async function openPrompt(idea: VeilleIdea) {
    const id = idea.id;
    if (!id) return;
    const known = prompts.current[id];
    if (known) {
      setPrompt({ idea, state: { status: "ready", prompt: known } });
      return;
    }
    setPrompt({ idea, state: { status: "loading" } });
    let state: PromptState;
    try {
      const loaded = await loadIdeaPrompt(id, idea.has_prompt);
      prompts.current[id] = loaded;
      state = { status: "ready", prompt: loaded };
    } catch (error) {
      state = {
        status: "error",
        message: errorText(error),
        retryable: retryable(error),
      };
    }
    // Fenêtre fermée ou autre idée ouverte entre-temps : rien à afficher
    setPrompt((open) => (open?.idea.id === id ? { idea, state } : open));
  }

  async function voteIdea(idea: VeilleIdea, clicked: VeilleVoteValue) {
    const next = await vote("idea", idea, clicked);
    if (next === "like") void openPrompt(idea);
  }

  const runs = view?.runs ?? [];
  const index =
    position === "day" || runs.length === 0
      ? null
      : position < 0
        ? runs.length - 1
        : Math.min(position, runs.length - 1);
  const selected = index === null ? undefined : runs[index];
  const run = selected ?? lastRun(runs);
  const days = latest?.days ?? (view ? [view.day] : []);
  const dayOptions =
    view && !days.includes(view.day) ? [view.day, ...days] : days;
  const lastSuccess = latest?.last_success_at;
  const missed = latest?.missed ?? [];
  const categories = view?.categories ?? latest?.categories ?? [];
  const entries = selected
    ? selected.items.map((value) => ({
        value,
        runFinishedAt: selected.finished_at,
      }))
    : dayItems(runs);
  const freshAt = new Map(entries.map((e) => [e.value, e.runFinishedAt]));
  const items: VeilleItem[] = entries.map((e) => e.value);
  const shown = filterItems(items, filters, (item) => voteOf("article", item));
  const ideas = selected ? selected.ideas : dayIdeas(runs).map((e) => e.value);
  const otherItems = others && others.day === view?.day ? others.items : null;
  const otherShown = otherItems
    ? sortOthers(
        filterItems(otherItems, otherFilters, (item) =>
          voteOf("article", item),
        ),
        otherOrder,
      )
    : [];
  const busy = runBusy(runStatus);

  return (
    <div className="veille__frame" ref={frame}>
      <header className="veille__header" ref={header}>
        <div className="veille__bar">
          <div className="veille__titles">
            <Dialog.Title asChild>
              <h2>{VEILLE_LABEL}</h2>
            </Dialog.Title>
            {view && (
              <p className="veille__when" data-testid="veille-when">
                {selected && index !== null
                  ? `Passage de ${formatTime(selected.finished_at)}${selected.manual ? " (manuel)" : ""}${selected.status === "failed" ? " (en échec)" : ""} · ${index + 1}/${runs.length}`
                  : `Toute la journée · ${runsLabel(runs)}`}
              </p>
            )}
          </div>
          <div className="veille__actions">
            <button
              type="button"
              className="veille-pill veille-run"
              data-busy={busy ? "true" : undefined}
              disabled={busy}
              title="Lancer une veille maintenant (météo, articles, idées)"
              onClick={() => void startRun()}
            >
              <RefreshCw aria-hidden="true" />
              {busy ? "En cours…" : "Nouveau passage"}
            </button>
            <button
              type="button"
              className="veille-pill"
              onClick={() => setStatsOpen(true)}
            >
              <ChartPie aria-hidden="true" />
              <span className="veille-pill__text">Statistiques</span>
            </button>
            <button
              type="button"
              className="veille-pill"
              onClick={() => setSourcesOpen(true)}
            >
              <Rss aria-hidden="true" />
              <span className="veille-pill__text">Sources</span>
            </button>
            <Dialog.Close asChild>
              <button type="button" className="veille-pill veille__close">
                <X aria-hidden="true" />
                <span className="veille-pill__text">Fermer</span>
              </button>
            </Dialog.Close>
          </div>
        </div>
        {view && (
          <div className="veille__nav">
            <button
              type="button"
              className="veille__step"
              aria-label="Passage précédent"
              disabled={index === 0 || runs.length === 0}
              onClick={() =>
                setPosition(index === null ? runs.length - 1 : index - 1)
              }
            >
              ‹
            </button>
            <button
              type="button"
              className="veille__step"
              aria-label="Passage suivant"
              disabled={index === null || index >= runs.length - 1}
              onClick={() => index !== null && setPosition(index + 1)}
            >
              ›
            </button>
            <button
              type="button"
              className="veille-pill veille__whole-day"
              aria-pressed={position === "day"}
              disabled={runs.length < 2}
              onClick={() => setPosition(position === "day" ? -1 : "day")}
            >
              Toute la journée
            </button>
            {dayOptions.length > 0 && (
              <select
                className="veille-select veille__day"
                aria-label="Jour"
                value={view.day}
                onChange={(event) => void showDay(event.target.value)}
              >
                {dayOptions.map((day) => (
                  <option key={day} value={day}>
                    {formatDay(day)}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </header>

      <div className="veille__body" aria-busy={loading}>
        {loading && !view && <p className="veille-muted">Chargement…</p>}
        {!loading && !view && (
          <p className="veille-muted veille-empty">
            Aucune veille pour l'instant : le service antares-tasks la prépare à
            8 h, 13 h et 18 h.
          </p>
        )}
        {view && (
          <>
            <WeatherPanel weather={view.weather} />
            <div
              className="veille-tabs"
              role="tablist"
              aria-label="Articles"
              data-testid="veille-tabs"
            >
              <button
                type="button"
                role="tab"
                id="veille-tab-featured"
                aria-controls="veille-panel-featured"
                aria-selected={tab === "featured"}
                className="veille-tab"
                onClick={() => setTab("featured")}
              >
                <Newspaper aria-hidden="true" />À la une
                <span className="veille-tab__count">{items.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                id="veille-tab-others"
                aria-controls="veille-panel-others"
                aria-selected={tab === "others"}
                className="veille-tab"
                onClick={() => setTab("others")}
              >
                <List aria-hidden="true" />
                Tous les articles
                <span className="veille-tab__count">
                  {otherItems ? otherItems.length : "…"}
                </span>
              </button>
            </div>

            {tab === "featured" && (
              <div
                role="tabpanel"
                id="veille-panel-featured"
                aria-labelledby="veille-tab-featured"
                className="veille-panel"
              >
                {items.length > 0 && (
                  <VeilleFilters
                    items={items}
                    categories={categories}
                    filters={filters}
                    onChange={setFilters}
                  />
                )}
                <section
                  className="veille-section"
                  aria-labelledby="veille-news"
                >
                  <div className="veille-section__head">
                    <h3 id="veille-news" className="veille-section__title">
                      <Newspaper aria-hidden="true" />
                      Actualités
                      {items.length > 0 && (
                        <span className="veille-section__count">
                          ({items.length})
                        </span>
                      )}
                    </h3>
                    {items.length > 0 && (
                      <p
                        className="veille-section__meta"
                        aria-live="polite"
                        data-testid="veille-count"
                      >
                        {countLabel(shown.length, items.length)}
                      </p>
                    )}
                  </div>
                  {!run && (
                    <p className="veille-muted">Aucun passage ce jour</p>
                  )}
                  {run && items.length === 0 && (
                    <p className="veille-muted">
                      {run.status === "failed"
                        ? "Aucune actualité : passage en échec"
                        : "Rien de notable"}
                    </p>
                  )}
                  {items.length > 0 && shown.length === 0 && (
                    <div className="veille-empty">
                      <p>Aucun article ne correspond à ces filtres.</p>
                      <button
                        type="button"
                        className="veille-pill"
                        onClick={() => setFilters(NO_FILTERS)}
                      >
                        Effacer les filtres
                      </button>
                    </div>
                  )}
                  {shown.length > 0 && (
                    <ul className="veille-grid">
                      {shown.map((item, position) => (
                        <ArticleCard
                          key={item.id ?? `${position}-${item.url}`}
                          item={item}
                          categoryLabel={categoryLabel(
                            item.category,
                            categories,
                          )}
                          vote={voteOf("article", item)}
                          isNew={hasNews(freshAt.get(item), previousOpened)}
                          now={now}
                          onVote={(value) => void vote("article", item, value)}
                          onOpen={() => setDetail(item)}
                        />
                      ))}
                    </ul>
                  )}
                </section>
                {ideas.length > 0 && (
                  <section
                    className="veille-section"
                    aria-labelledby="veille-ideas"
                  >
                    <div className="veille-section__head">
                      <h3 id="veille-ideas" className="veille-section__title">
                        <Lightbulb aria-hidden="true" />
                        Idées pour Antares
                        <span className="veille-section__count">
                          ({ideas.length})
                        </span>
                      </h3>
                      <p className="veille-section__meta">
                        « Intéressé » prépare un prompt prêt pour Claude Code.
                      </p>
                    </div>
                    <ul className="veille-grid">
                      {ideas.map((idea, position) => (
                        <IdeaCard
                          key={idea.id ?? `${position}-${idea.title}`}
                          idea={idea}
                          vote={voteOf("idea", idea)}
                          onVote={(value) => void voteIdea(idea, value)}
                          onShowPrompt={() => void openPrompt(idea)}
                        />
                      ))}
                    </ul>
                  </section>
                )}
                {run && run.errors.length > 0 && (
                  <section
                    className="veille-section"
                    aria-labelledby="veille-errors"
                  >
                    <h3 id="veille-errors" className="veille-section-title">
                      {selected
                        ? "Erreurs du passage"
                        : "Erreurs du dernier passage"}
                    </h3>
                    <ul className="veille__errors">
                      {run.errors.map((error, position) => (
                        <li key={`${position}-${error}`}>{error}</li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}

            {tab === "others" && (
              <div
                role="tabpanel"
                id="veille-panel-others"
                aria-labelledby="veille-tab-others"
                className="veille-panel"
              >
                {otherItems && otherItems.length > 0 && (
                  <VeilleFilters
                    items={otherItems}
                    categories={categories}
                    filters={otherFilters}
                    onChange={setOtherFilters}
                  />
                )}
                <section
                  className="veille-section"
                  aria-labelledby="veille-others-title"
                >
                  <div className="veille-section__head">
                    <h3
                      id="veille-others-title"
                      className="veille-section__title"
                    >
                      <List aria-hidden="true" />
                      Tous les articles
                    </h3>
                    <p
                      className="veille-section__meta"
                      aria-live="polite"
                      data-testid="veille-others-count"
                    >
                      {otherItems
                        ? `${countLabel(otherShown.length, otherItems.length)} lus mais non retenus par l'IA ; vos votes l'aident à mieux choisir`
                        : "Chargement…"}
                    </p>
                  </div>
                  {others?.error && (
                    <p className="veille-muted" role="alert">
                      Liste indisponible : {others.error}
                    </p>
                  )}
                  {otherItems && otherItems.length === 0 && !others?.error && (
                    <p className="veille-muted">
                      Aucun autre article ce jour : tous les articles lus sont à
                      la une, ou le passage date d'avant cette liste.
                    </p>
                  )}
                  {otherItems &&
                    otherItems.length > 0 &&
                    otherShown.length === 0 && (
                      <div className="veille-empty">
                        <p>Aucun article ne correspond à ces filtres.</p>
                        <button
                          type="button"
                          className="veille-pill"
                          onClick={() => setOtherFilters(NO_FILTERS)}
                        >
                          Effacer les filtres
                        </button>
                      </div>
                    )}
                  {otherShown.length > 0 && (
                    <OtherList
                      key={`${view.day}-${otherOrder}-${JSON.stringify(otherFilters)}`}
                      items={otherShown}
                      categories={categories}
                      order={otherOrder}
                      now={now}
                      voteOf={(item) => voteOf("article", item)}
                      onOrder={setOtherOrder}
                      onVote={(item, value) =>
                        void vote("article", item, value)
                      }
                      onOpen={(item) => setDetail(item)}
                    />
                  )}
                </section>
              </div>
            )}
          </>
        )}
        <footer className="veille__footer">
          <p>
            Dernier passage réussi :{" "}
            {lastSuccess ? formatDateTime(lastSuccess) : "aucun"}
          </p>
          {missed.length > 0 && (
            <p>
              Créneaux manqués :{" "}
              {missed
                .map(
                  (m) =>
                    `${formatDateTime(m.slot_at)}${m.status === "failed" ? " (interrompu)" : ""}`,
                )
                .join(", ")}
            </p>
          )}
        </footer>
      </div>

      <p
        className="veille-notice"
        role="status"
        data-visible={notice ? "true" : "false"}
        data-testid="veille-notice"
      >
        {notice}
      </p>

      {sourcesOpen && <SourcesDialog onClose={() => setSourcesOpen(false)} />}

      {statsOpen && (
        <StatsDialog
          categories={categories}
          onClose={() => setStatsOpen(false)}
        />
      )}

      {detail && (
        <ArticleDialog
          item={detail}
          categoryLabel={categoryLabel(detail.category, categories)}
          vote={voteOf("article", detail)}
          favorite={favorites ? favorites.has(detail.source) : null}
          onVote={(value) => void vote("article", detail, value)}
          onFavorite={() => void toggleFavorite(detail.source)}
          onClose={() => setDetail(null)}
        />
      )}

      {prompt && (
        <IdeaPromptDialog
          title={prompt.idea.title}
          state={prompt.state}
          onClose={() => setPrompt(null)}
          onRetry={() => void openPrompt(prompt.idea)}
        />
      )}
    </div>
  );
}
