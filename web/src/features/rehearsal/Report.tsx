// Rapport noté (port de renderReport, rehearsal.js) : note et critères, points forts,
// améliorations avec la slide concernée, phrases à éviter, questions-réponses, rythme ;
// annexe des révisions (imprimée). Rendu dans le panneau, donc dans #root.
import { Dialog } from "radix-ui";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { rehearsal } from "./instance";
import { LocalDialog } from "./LocalDialog";
import {
  formatDate,
  initialScores,
  longClock,
  revised,
} from "./rehearsalMachine";
import type { Session } from "./controller";
import type { DiscussionMessage, Report as ReportData } from "./types";

const cssVar = (name: string, value: number) =>
  ({ [name]: value }) as CSSProperties;

function Section({
  sectionKey,
  title,
  reading,
  children,
}: {
  sectionKey: string;
  title: string;
  reading: boolean;
  children: ReactNode;
}) {
  const node = useRef<HTMLElement>(null);
  useEffect(() => {
    if (reading)
      node.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [reading]);
  return (
    <section
      ref={node}
      className={`report__section${reading ? " is-reading" : ""}`}
      data-section={sectionKey}
    >
      <h3>
        {title}
        <button
          type="button"
          className="report__play"
          title="Faire lire cette partie par l'avatar"
          onClick={() => rehearsal.readSection(sectionKey)}
        >
          Écouter
        </button>
      </h3>
      {children}
    </section>
  );
}

export function RevisionList({ report }: { report: ReportData }) {
  return (
    <ol className="revisions">
      {(report.revisions ?? []).map((change, index) => (
        <li key={`${change.at}-${index}`}>
          <p className="revisions__head">
            <strong>{change.label}</strong>
            {` ${change.before} → ${change.after} sur ${report.criteria[0]?.max ?? 4}`}
            <span className="revisions__date">{formatDate(change.at)}</span>
          </p>
          {change.reason && (
            <p className="revisions__reason">{change.reason}</p>
          )}
        </li>
      ))}
    </ol>
  );
}

export function Bubble({ message }: { message: DiscussionMessage }) {
  return (
    <div className={`discussion__message discussion__message--${message.role}`}>
      <p>{message.text}</p>
      {(message.revisions ?? []).map((change, index) => (
        <span
          key={index}
          className={`discussion__change ${change.after > change.before ? "is-up" : "is-down"}`}
        >
          {`${change.label} : ${change.before} → ${change.after}`}
        </span>
      ))}
      {message.via === "voice" && (
        <span className="discussion__via">à l'oral</span>
      )}
    </div>
  );
}

function DiscussionHistory({
  session,
  open,
  onClose,
}: {
  session: Session;
  open: boolean;
  onClose(): void;
}) {
  const report = session.data.report;
  if (!report) return null;
  return (
    <LocalDialog
      open={open}
      onClose={onClose}
      className="settings discussion-history"
      title="Historique de la note"
      showTitle
    >
      <div className="settings__form">
        <header className="settings__header dialog__header">
          <Dialog.Title asChild>
            <h2>Historique de la note</h2>
          </Dialog.Title>
          <p>
            {revised(report)
              ? `Note actuelle ${report.score}/${report.out_of}, initialement ${report.initial_score}/${report.out_of}.`
              : `Note actuelle ${report.score}/${report.out_of}.`}
          </p>
        </header>
        <div className="discussion-history__body">
          <h3>Révisions</h3>
          <RevisionList report={report} />
          <h3>Échanges</h3>
          <div className="discussion__thread">
            {(session.data.discussion ?? []).map((message, index) => (
              <Bubble key={index} message={message} />
            ))}
          </div>
        </div>
        <footer className="settings__actions dialog__footer">
          <button type="button" className="button-primary" onClick={onClose}>
            Fermer
          </button>
        </footer>
      </div>
    </LocalDialog>
  );
}

export function Report({ session }: { session: Session }) {
  const [viewer, setViewer] = useState<number | null>(null);
  const [history, setHistory] = useState(false);
  const { data, readingSection } = session;
  const report = data.report;
  if (!report) return null;
  const measured = report.metrics;
  const initial = initialScores(report);
  const reading = (key: string) => readingSection === key;

  const slideChip = (number: number) => (
    <button
      type="button"
      className="report__chip"
      onClick={() => setViewer(number)}
    >
      {`Slide ${number}`}
    </button>
  );

  const over =
    measured.target_seconds !== undefined && measured.target_seconds
      ? measured.duration - measured.target_seconds
      : 0;
  const figures: { label: string; value: string; warn: boolean }[] = [
    {
      label: "Durée",
      value: measured.target_seconds
        ? `${longClock(measured.duration)} / ${longClock(measured.target_seconds)}`
        : longClock(measured.duration),
      warn: Math.abs(over) >= 60,
    },
    {
      label: "Débit",
      value: `${measured.words_per_minute} mots/min`,
      warn: measured.words_per_minute < 110 || measured.words_per_minute > 170,
    },
    { label: "Mots", value: String(measured.words), warn: false },
  ];
  if (Object.keys(measured.fillers).length) {
    figures.push({
      label: "Mots qui reviennent",
      value: Object.entries(measured.fillers)
        .slice(0, 3)
        .map(([word, n]) => `${word} ×${n}`)
        .join(", "),
      warn: true,
    });
  }
  const longest = Math.max(...measured.per_slide.map((s) => s.seconds), 1);
  const revisionCount = report.revisions?.length ?? 0;

  return (
    <>
      <header className="report__head">
        <div>
          <h2>{data.title}</h2>
          <p className="report__meta">
            {`${data.audience_name} · ${new Date(
              report.created * 1000,
            ).toLocaleString("fr-FR", {
              dateStyle: "long",
              timeStyle: "short",
            })}`}
          </p>
        </div>
        <div className="report__controls">
          <button
            type="button"
            className="button-ghost report__listen"
            onClick={() => rehearsal.toggleListen()}
          >
            {readingSection ? "Arrêter la lecture" : "Écouter"}
          </button>
          <button
            type="button"
            className="button-ghost"
            onClick={() => rehearsal.openDiscussion()}
          >
            Discuter de la note
          </button>
          <button
            type="button"
            className="button-ghost"
            onClick={() => window.print()}
          >
            Imprimer / PDF
          </button>
        </div>
      </header>

      <Section sectionKey="score" title="Note" reading={reading("score")}>
        <div
          className="report__score"
          style={cssVar("--score", report.score / report.out_of)}
        >
          <strong>{report.score}</strong>
          <span>{`/ ${report.out_of}`}</span>
        </div>
        <div className="report__verdict">
          <p>{report.verdict}</p>
          <ul className="report__criteria">
            {report.criteria.map((criterion) => {
              const before = initial[criterion.key];
              const delta =
                before !== undefined && before !== criterion.score
                  ? criterion.score - before
                  : null;
              return (
                <li key={criterion.key}>
                  <span className="report__label">{criterion.label}</span>
                  <span
                    className="report__bar"
                    style={cssVar("--value", criterion.score / criterion.max)}
                  />
                  <span
                    className="report__value"
                    title={
                      delta !== null
                        ? `Initialement ${before}/${criterion.max}`
                        : undefined
                    }
                  >
                    {`${criterion.score}/${criterion.max}`}
                    {delta !== null && (
                      <span
                        className={`report__delta ${delta > 0 ? "is-up" : "is-down"}`}
                      >
                        {delta > 0 ? `+${delta}` : String(delta)}
                      </span>
                    )}
                  </span>
                  <span className="report__comment">{criterion.comment}</span>
                </li>
              );
            })}
          </ul>
          {revisionCount > 0 && (
            <p className="report__revised">
              {revised(report)
                ? `Note révisée (initialement ${report.initial_score}/${report.out_of}) · `
                : `${revisionCount} révision${revisionCount > 1 ? "s" : ""}, note inchangée · `}
              <button
                type="button"
                className="link-button"
                onClick={() => setHistory(true)}
              >
                Voir l'historique
              </button>
            </p>
          )}
        </div>
      </Section>

      {report.strengths.length > 0 && (
        <Section
          sectionKey="strengths"
          title="Points forts"
          reading={reading("strengths")}
        >
          <ul className="report__list report__list--good">
            {report.strengths.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </Section>
      )}

      {report.improvements.length > 0 && (
        <Section
          sectionKey="improvements"
          title="À améliorer, pas à pas"
          reading={reading("improvements")}
        >
          <ol className="report__steps">
            {report.improvements.map((item, index) => (
              <li key={index}>
                <p className="report__issue">
                  {item.slide ? <>{slideChip(item.slide)} </> : null}
                  {item.issue}
                </p>
                {item.advice && <p className="report__advice">{item.advice}</p>}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {report.avoid.length > 0 && (
        <Section
          sectionKey="avoid"
          title="À ne pas dire"
          reading={reading("avoid")}
        >
          {report.avoid.map((item, index) => (
            <article key={index} className="report__quote">
              <blockquote className="report__said">{`« ${item.quote} »`}</blockquote>
              {item.why && <p className="report__why">{item.why}</p>}
              {item.instead && (
                <p className="report__instead">
                  <strong>Dites plutôt : </strong>
                  {`« ${item.instead} »`}
                </p>
              )}
            </article>
          ))}
        </Section>
      )}

      {report.answers.length > 0 && (
        <Section
          sectionKey="answers"
          title="Questions-réponses"
          reading={reading("answers")}
        >
          {report.answers.map((item, index) => (
            <article key={index} className="report__qa">
              <p className="report__question">{item.question}</p>
              {item.assessment && (
                <p className="report__why">{item.assessment}</p>
              )}
              {item.better && (
                <p className="report__instead">
                  <strong>Réponse possible : </strong>
                  {item.better}
                </p>
              )}
            </article>
          ))}
        </Section>
      )}

      <Section
        sectionKey="metrics"
        title="Rythme et temps"
        reading={reading("metrics")}
      >
        <dl className="report__figures">
          {figures.map((figure) => (
            <div key={figure.label} className={figure.warn ? "is-warn" : ""}>
              <dt>{figure.label}</dt>
              <dd>{figure.value}</dd>
            </div>
          ))}
        </dl>
        <ul className="report__slides">
          {measured.per_slide.map((slide) => (
            <li
              key={slide.slide}
              className={
                measured.skipped.includes(slide.slide) ? "is-warn" : ""
              }
            >
              <span className="report__label">{`Slide ${slide.slide}`}</span>
              <span
                className="report__bar"
                style={cssVar("--value", slide.seconds / longest)}
              />
              <span className="report__value">{longClock(slide.seconds)}</span>
            </li>
          ))}
        </ul>
      </Section>

      {revisionCount > 0 && (
        // Annexe imprimée : les révisions de la note, sans le fil de la discussion
        <section className="report__section report__annex">
          <h3>Annexe · révisions de la note</h3>
          <RevisionList report={report} />
        </section>
      )}

      <LocalDialog
        open={viewer !== null}
        onClose={() => setViewer(null)}
        onContentClick={() => setViewer(null)}
        className="settings report__viewer"
        title={`Slide ${viewer ?? ""}`}
      >
        {viewer !== null && (
          <img
            src={`api/rehearsals/${data.id}/slides/${viewer}`}
            alt={`Slide ${viewer}`}
          />
        )}
      </LocalDialog>
      <DiscussionHistory
        session={session}
        open={history}
        onClose={() => setHistory(false)}
      />
    </>
  );
}
