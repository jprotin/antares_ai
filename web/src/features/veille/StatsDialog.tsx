// Fenêtre « Statistiques » de la veille, sur 7 jours, 30 jours ou un an : chiffres clés
// (taux d'accord, articles ratés, votes, sélection, idées), ce que l'utilisateur aime
// lire (catégories, sources, mots), ce que choisit l'IA (catégories, sources mises en
// avant, taux de sélection) et l'évolution par jour. Chaque graphique a sa table de
// chiffres (« Voir les chiffres »).
import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { VeilleCategory, VeilleStats } from "@/types/api";

import { loadStats } from "./api";
import {
  agreementByDay,
  articles,
  percent,
  shortDay,
  STATS_PERIODS,
  type StatsPeriod,
} from "./stats";
import { BarList, DayColumns, Donut, PercentLine } from "./StatsCharts";
import { formatDay } from "./veille";

type State =
  | { status: "loading" }
  | { status: "ready"; stats: VeilleStats }
  | { status: "error"; message: string };

const likes = (n: number) => `${n} j'aime`;

function Numbers({
  head,
  rows,
}: {
  head: readonly string[];
  rows: readonly (readonly (string | number)[])[];
}) {
  return (
    <details className="veille-numbers">
      <summary>Voir les chiffres</summary>
      <table>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row[0])}>
              {row.map((cell, index) => (
                <td key={index}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function Tile({
  label,
  value,
  note,
  testId,
}: {
  label: string;
  value: string;
  note: string;
  testId?: string;
}) {
  return (
    <div className="veille-kpi" data-testid={testId}>
      <p className="veille-kpi__label">{label}</p>
      <p className="veille-kpi__value">{value}</p>
      <p className="veille-kpi__note">{note}</p>
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="veille-muted veille-stats__empty">{children}</p>;
}

export function StatsDialog({
  categories,
  onClose,
}: {
  categories: readonly VeilleCategory[];
  onClose: () => void;
}) {
  const [days, setDays] = useState<StatsPeriod>(30);
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    loadStats(days).then(
      (stats) => active && setState({ status: "ready", stats }),
      (error: unknown) =>
        active &&
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
    );
    return () => {
      active = false;
    };
  }, [days, attempt]);

  // Nouvelle période ou nouvel essai : chargement affiché avant la relecture
  function reload(next: StatsPeriod) {
    setState({ status: "loading" });
    if (next === days) setAttempt(attempt + 1);
    else setDays(next);
  }

  const stats = state.status === "ready" ? state.stats : null;
  const s = stats?.summary;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="veille-prompt veille-stats flex max-h-[min(94dvh,64rem)] flex-col gap-0 p-0 sm:max-w-5xl motion-reduce:animate-none"
        data-testid="veille-stats"
      >
        <header className="veille-prompt__header veille-stats__header">
          <div>
            <p className="veille-prompt__kicker">Veille</p>
            <DialogTitle className="veille-prompt__title text-lg leading-snug font-bold">
              Statistiques
            </DialogTitle>
            <DialogDescription className="veille-prompt__desc">
              {stats
                ? `Du ${formatDay(stats.since)} au ${formatDay(stats.until)}`
                : "Vos goûts et les choix de l'IA"}
            </DialogDescription>
          </div>
          <div className="veille-segmented" role="group" aria-label="Période">
            {STATS_PERIODS.map((period) => (
              <button
                key={period.days}
                type="button"
                aria-pressed={days === period.days}
                onClick={() => period.days !== days && reload(period.days)}
              >
                {period.label}
              </button>
            ))}
          </div>
        </header>

        <div
          className="veille-stats__body"
          aria-busy={state.status === "loading"}
        >
          {state.status === "loading" && (
            <p className="veille-muted">Calcul des statistiques…</p>
          )}
          {state.status === "error" && (
            <div className="veille-prompt__error" role="alert">
              <p>Statistiques indisponibles : {state.message}</p>
              <button
                type="button"
                className="veille-pill veille-pill--primary"
                onClick={() => reload(days)}
              >
                <RotateCcw aria-hidden="true" />
                Réessayer
              </button>
            </div>
          )}
          {stats && s && (
            <>
              <section className="veille-kpis" aria-label="Chiffres clés">
                <Tile
                  label="Taux d'accord"
                  value={percent(s.agreement)}
                  note={
                    s.agreement_votes
                      ? `de j'aime sur ${s.agreement_votes} votes d'articles à la une`
                      : "aucun vote sur un article à la une"
                  }
                  testId="veille-kpi-agreement"
                />
                <Tile
                  label="Articles ratés"
                  value={String(s.missed_likes)}
                  note="aimés alors que l'IA les avait écartés"
                  testId="veille-kpi-missed"
                />
                <Tile
                  label="Vos votes"
                  value={`${s.likes} / ${s.dislikes}`}
                  note="j'aime / je n'aime pas"
                />
                <Tile
                  label="Sélection de l'IA"
                  value={percent(
                    s.collected
                      ? Math.round((1000 * s.featured) / s.collected) / 10
                      : null,
                  )}
                  note={`${articles(s.featured)} à la une sur ${s.collected} lus`}
                />
                <Tile
                  label="Idées"
                  value={`${s.ideas_interested} / ${s.ideas_rejected}`}
                  note="intéressé / pas intéressé"
                />
              </section>

              <section
                className="veille-stats__section"
                aria-labelledby="veille-stats-tastes"
              >
                <h3 id="veille-stats-tastes" className="veille-stats__title">
                  Ce que vous aimez lire
                </h3>
                <div className="veille-stats__grid">
                  <div className="veille-stats__card">
                    <h4>Vos j'aime par catégorie</h4>
                    {stats.tastes.categories.length ? (
                      <>
                        <Donut
                          title="Vos j'aime par catégorie"
                          slices={stats.tastes.categories}
                          categories={categories}
                          unit={likes}
                        />
                        <Numbers
                          head={[
                            "Catégorie",
                            "J'aime",
                            "Je n'aime pas",
                            "Part",
                          ]}
                          rows={stats.tastes.categories.map((c) => [
                            c.label,
                            c.count,
                            c.dislikes,
                            percent(c.share),
                          ])}
                        />
                      </>
                    ) : (
                      <Empty>Aucun j'aime sur la période.</Empty>
                    )}
                  </div>
                  <div className="veille-stats__card">
                    <h4>Sources préférées</h4>
                    {stats.tastes.sources.length ? (
                      <>
                        <BarList
                          rows={stats.tastes.sources.map((r) => ({
                            label: r.name,
                            value: r.likes,
                            note: r.dislikes
                              ? `${r.dislikes} je n'aime pas`
                              : "",
                          }))}
                          valueLabel={(row) => likes(row.value)}
                        />
                        <Numbers
                          head={["Source", "J'aime", "Je n'aime pas", "Taux"]}
                          rows={stats.tastes.sources.map((r) => [
                            r.name,
                            r.likes,
                            r.dislikes,
                            percent(r.like_rate),
                          ])}
                        />
                      </>
                    ) : (
                      <Empty>Aucun vote sur la période.</Empty>
                    )}
                  </div>
                  <div className="veille-stats__card">
                    <h4>Mots qui reviennent dans vos j'aime</h4>
                    {stats.tastes.words.length ? (
                      <ul className="veille-words">
                        {stats.tastes.words.map((w) => (
                          <li key={w.word}>
                            {w.word}
                            <span className="veille-words__count">
                              {w.count}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Empty>Pas encore assez de j'aime.</Empty>
                    )}
                  </div>
                </div>
              </section>

              <section
                className="veille-stats__section"
                aria-labelledby="veille-stats-ai"
              >
                <h3 id="veille-stats-ai" className="veille-stats__title">
                  Ce que choisit l'IA
                </h3>
                <div className="veille-stats__grid">
                  <div className="veille-stats__card">
                    <h4>Articles à la une par catégorie</h4>
                    {stats.ai.categories.length ? (
                      <>
                        <Donut
                          title="Articles à la une par catégorie"
                          slices={stats.ai.categories}
                          categories={categories}
                          unit={articles}
                        />
                        <Numbers
                          head={["Catégorie", "Articles", "Part"]}
                          rows={stats.ai.categories.map((c) => [
                            c.label,
                            c.count,
                            percent(c.share),
                          ])}
                        />
                      </>
                    ) : (
                      <Empty>Aucun passage sur la période.</Empty>
                    )}
                  </div>
                  <div className="veille-stats__card veille-stats__card--wide">
                    <h4>Sources les plus mises en avant</h4>
                    {stats.ai.sources.length ? (
                      <>
                        <BarList
                          rows={stats.ai.sources.map((r) => ({
                            label: r.name,
                            value: r.featured,
                            note: `${percent(r.selection_rate)} de ses ${r.collected} articles lus retenus`,
                          }))}
                          valueLabel={(row) =>
                            `${articles(row.value)} · ${percent(stats.ai.sources.find((r) => r.name === row.label)?.share)}`
                          }
                        />
                        <Numbers
                          head={[
                            "Source",
                            "À la une",
                            "Part",
                            "Lus",
                            "Sélection",
                          ]}
                          rows={stats.ai.sources.map((r) => [
                            r.name,
                            r.featured,
                            percent(r.share),
                            r.collected,
                            percent(r.selection_rate),
                          ])}
                        />
                      </>
                    ) : (
                      <Empty>Aucun passage sur la période.</Empty>
                    )}
                  </div>
                </div>
              </section>

              <section
                className="veille-stats__section"
                aria-labelledby="veille-stats-time"
              >
                <h3 id="veille-stats-time" className="veille-stats__title">
                  Évolution
                </h3>
                {stats.timeline.length ? (
                  <div className="veille-stats__grid veille-stats__grid--two">
                    <div className="veille-stats__card">
                      <h4>Articles à la une par jour</h4>
                      <DayColumns
                        days={stats.timeline}
                        categories={categories}
                      />
                    </div>
                    <div className="veille-stats__card">
                      <h4>Taux d'accord par jour</h4>
                      <PercentLine
                        points={agreementByDay(stats.timeline)}
                        label="Taux d'accord par jour, en pourcentage"
                        detail={(index) => {
                          const d = stats.timeline[index]!;
                          const votes = d.agree_likes + d.agree_dislikes;
                          return votes
                            ? `${shortDay(d.day)} : ${percent(agreementByDay([d])[0]!.value)} (${d.agree_likes} j'aime sur ${votes}), ${d.missed_likes} article(s) raté(s)`
                            : `${shortDay(d.day)} : aucun vote sur un article à la une`;
                        }}
                      />
                    </div>
                    <Numbers
                      head={[
                        "Jour",
                        "À la une",
                        "J'aime à la une",
                        "Je n'aime pas à la une",
                        "Articles ratés",
                      ]}
                      rows={stats.timeline.map((d) => [
                        shortDay(d.day),
                        Object.values(d.featured).reduce((a, b) => a + b, 0),
                        d.agree_likes,
                        d.agree_dislikes,
                        d.missed_likes,
                      ])}
                    />
                  </div>
                ) : (
                  <Empty>Aucune donnée sur la période.</Empty>
                )}
              </section>
            </>
          )}
        </div>

        <footer className="veille-prompt__footer">
          <p className="veille-prompt__meta">
            Votes gardés tant que vous ne les retirez pas ; résumés des passages
            gardés un an.
          </p>
          <div className="veille-prompt__actions">
            <DialogClose asChild>
              <button type="button" className="veille-pill">
                Fermer
              </button>
            </DialogClose>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
