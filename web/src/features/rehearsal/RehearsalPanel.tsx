// Panneau de la Répétition (section#rehearsal, rendu par AppShell via FeatureDef.panel) :
// étapes, horloge, micro et filtre du bruit, slides, rapport, discussion, sous-titres.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { engine } from "@/app/runtime";
import { isAnyDialogOpen } from "@/state/slices/ui";
import { store } from "@/state/store";

import type { Session } from "./controller";
import { rehearsal } from "./instance";
import { Bubble, Report } from "./Report";
import {
  meterPosition,
  revised,
  slidesHidden,
  STEPS,
  stepStates,
} from "./rehearsalMachine";
import { useRehearsal } from "./useRehearsal";
import "./rehearsal.css";
import "./print.css";

const NOISE_OPTIONS = [
  ["light", "Léger"],
  ["normal", "Normal"],
  ["strong", "Fort"],
] as const;

// Niveau du micro, seuil du filtre, état et bouton Interrompre : lus à chaque image,
// hors de l'état React pour le niveau (variables CSS en CSSOM)
function MicBar({ session }: { session: Session | null }) {
  const meter = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState("Micro inactif");
  const [voice, setVoice] = useState(false);
  const [avatarSpeaking, setAvatarSpeaking] = useState(false);
  const active = Boolean(session);

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const update = () => {
      const current = rehearsal.session;
      if (!current) return;
      const { gate } = rehearsal;
      const avatar = engine.playing();
      const listening = engine.inCall() && !avatar && current.micOpen;
      meter.current?.style.setProperty(
        "--level",
        String(listening ? meterPosition(gate.level) : 0),
      );
      meter.current?.style.setProperty(
        "--threshold",
        String(meterPosition(gate.threshold)),
      );
      setVoice(listening && gate.open);
      setState(
        !engine.inCall()
          ? "Micro inactif"
          : avatar || !current.micOpen
            ? "Micro coupé"
            : gate.open
              ? "Voix captée"
              : "Bruit filtré",
      );
      setAvatarSpeaking(avatar);
      frame = window.requestAnimationFrame(update);
    };
    frame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  return (
    <>
      <div className="rehearsal__mic">
        <span
          ref={meter}
          className={`mic-meter${voice ? " is-voice" : ""}`}
          id="rehearsal-mic"
          title="Niveau du micro ; le trait marque le seuil sous lequel le son est ignoré"
          aria-hidden="true"
        />
        <span className="rehearsal__mic-state" id="rehearsal-mic-state">
          {state}
        </span>
        <label className="rehearsal__noise">
          Filtre du bruit
          <select
            id="rehearsal-noise"
            value={rehearsal.gate.name}
            onChange={(event) => rehearsal.setNoiseFilter(event.target.value)}
          >
            {NOISE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <InterruptAndActions session={session} avatarSpeaking={avatarSpeaking} />
    </>
  );
}

function InterruptAndActions({
  session,
  avatarSpeaking,
}: {
  session: Session | null;
  avatarSpeaking: boolean;
}) {
  return (
    <div className="rehearsal__actions">
      <button
        type="button"
        className="button-ghost"
        id="rehearsal-interrupt"
        hidden={!avatarSpeaking}
        onClick={() => rehearsal.interruptAvatar()}
      >
        Interrompre
      </button>
      <button
        type="button"
        className="link-button"
        id="rehearsal-quit"
        onClick={() => rehearsal.quit()}
      >
        Quitter
      </button>
      <button
        type="button"
        className="button-primary"
        id="rehearsal-next"
        disabled={session?.nextDisabled ?? false}
        onClick={() => void rehearsal.next()}
      >
        {session?.nextLabel ?? "J'ai terminé mon discours"}
      </button>
    </div>
  );
}

function Discussion({ session }: { session: Session }) {
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const report = session.data.report;
  const messages = session.data.discussion ?? [];

  useEffect(() => {
    if (session.discussionOpen) field.current?.focus();
  }, [session.discussionOpen]);

  useLayoutEffect(() => {
    const node = thread.current;
    if (node) node.scrollTop = node.scrollHeight;
  });

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const message = text.trim();
    if (!message) return;
    setText("");
    if (!(await rehearsal.sendWritten(message))) setText(message);
  }

  return (
    <aside
      className="discussion"
      id="rehearsal-discussion"
      aria-labelledby="discussion-title"
      hidden={!session.discussionOpen}
    >
      <header className="discussion__head">
        <div>
          <h3 id="discussion-title">Discuter de la note</h3>
          <p className="discussion__score" id="discussion-score">
            {report &&
              (revised(report)
                ? `${report.score}/${report.out_of} · initialement ${report.initial_score}/${report.out_of}`
                : `${report.score}/${report.out_of}`)}
          </p>
        </div>
        <button
          type="button"
          className="preview-button"
          id="discussion-close"
          aria-label="Fermer la discussion"
          onClick={() => rehearsal.closeDiscussion()}
        >
          ×
        </button>
      </header>
      <div className="discussion__thread" id="discussion-thread" ref={thread}>
        {messages.map((message, index) => (
          <Bubble key={index} message={message} />
        ))}
        {!messages.length && !session.said && (
          <p className="discussion__empty">
            Expliquez un contexte que le coach ignorait ou signalez une erreur
            de sa part : il peut revoir une note d'un point par critère, à la
            hausse comme à la baisse. Une simple contestation ne change rien.
          </p>
        )}
        {session.said && (
          <>
            <Bubble
              message={{ role: "user", text: session.said, via: "voice" }}
            />
            <p className="discussion__waiting">Le coach réfléchit…</p>
          </>
        )}
        {session.discussionWaiting && (
          <p className="discussion__waiting">Le coach réfléchit…</p>
        )}
      </div>
      <form
        className="discussion__form"
        id="discussion-form"
        onSubmit={(event) => void submit(event)}
      >
        <textarea
          ref={field}
          id="discussion-text"
          rows={3}
          maxLength={4000}
          placeholder="Ex. : j'ai survolé la slide 3 volontairement, le client la connaît déjà."
          aria-label="Votre message au coach"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <p className="settings__error" id="discussion-error" role="alert">
          {session.discussionError}
        </p>
        <div className="discussion__actions">
          <button
            type="button"
            className="button-ghost"
            id="discussion-talk"
            aria-pressed={session.talking}
            onClick={() => rehearsal.toggleTalking()}
          >
            {session.talking ? "Couper le micro" : "Parler"}
          </button>
          <button
            type="submit"
            className="button-primary"
            id="discussion-send"
            disabled={session.discussionSending}
          >
            Envoyer
          </button>
        </div>
      </form>
    </aside>
  );
}

const FORWARD = ["ArrowRight", "PageDown", " ", "ArrowDown"];
const BACK = ["ArrowLeft", "PageUp", "ArrowUp"];

export function RehearsalPanel() {
  const session = useRehearsal();
  const report = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const phase = session?.shownPhase;
  const hideSlides = phase ? slidesHidden(phase) : false;
  const states = phase ? stepStates(phase) : [];

  // Nouveau rapport : lecture depuis le haut (une note révisée garde la position)
  useLayoutEffect(() => {
    if (report.current) report.current.scrollTop = 0;
  }, [session?.reportKey]);

  // Flèches, Page, Espace : slide suivante ou précédente, sauf fenêtre ouverte ou
  // focus dans un champ
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = rehearsal.session;
      if (!current || slidesHidden(current.shownPhase)) return;
      if (
        isAnyDialogOpen(store.getState()) ||
        document.querySelector('[role="dialog"]')
      )
        return;
      if (
        (event.target as Element | null)?.closest?.("input, textarea, select")
      )
        return;
      if (FORWARD.includes(event.key)) rehearsal.showSlide(current.slide + 1);
      else if (BACK.includes(event.key)) rehearsal.showSlide(current.slide - 1);
      else return;
      event.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const total = session?.data.slides.length ?? 1;
  const slide = session?.slide ?? 1;

  return (
    <section
      className={`rehearsal${session?.discussionOpen ? " is-discussing" : ""}`}
      id="rehearsal"
      aria-label="Répétition de la présentation"
      hidden={!session}
    >
      <header className="rehearsal__bar">
        <ol className="rehearsal__steps">
          {STEPS.map(({ step, label }, index) => (
            <li
              key={step}
              data-step={step}
              className={
                states[index] === "done"
                  ? "is-done"
                  : states[index] === "current"
                    ? "is-current"
                    : undefined
              }
            >
              {label}
            </li>
          ))}
        </ol>
        <span
          className={`rehearsal__clock${session?.clockOver ? " is-over" : ""}`}
          id="rehearsal-clock"
          role="timer"
        >
          {session?.clockText ?? "0:00"}
        </span>
        <MicBar session={session} />
      </header>
      <figure
        className="rehearsal__slide"
        id="rehearsal-slide-box"
        hidden={hideSlides}
      >
        <img
          ref={image}
          id="rehearsal-slide"
          src={
            session && session.slide
              ? `api/rehearsals/${session.data.id}/slides/${session.slide}`
              : undefined
          }
          alt={session?.slide ? `Slide ${session.slide}` : ""}
          onClick={(event) => {
            if (!session || !image.current) return;
            const { left, width } = image.current.getBoundingClientRect();
            rehearsal.showSlide(
              session.slide + (event.clientX - left < width / 3 ? -1 : 1),
            );
          }}
        />
        <figcaption className="rehearsal__nav">
          <button
            type="button"
            className="preview-button"
            id="rehearsal-prev"
            aria-label="Slide précédente"
            onClick={() => session && rehearsal.showSlide(session.slide - 1)}
          >
            ‹
          </button>
          <span id="rehearsal-count">{`${slide} / ${total}`}</span>
          <button
            type="button"
            className="preview-button"
            id="rehearsal-forward"
            aria-label="Slide suivante"
            onClick={() => session && rehearsal.showSlide(session.slide + 1)}
          >
            ›
          </button>
          <span className="rehearsal__hint" id="rehearsal-hint">
            {session?.hint}
          </span>
        </figcaption>
      </figure>
      <div
        className="report"
        id="rehearsal-report"
        ref={report}
        hidden={!session || !hideSlides}
      >
        {session?.reportStatus && "waiting" in session.reportStatus && (
          <p className="report__waiting">
            Le coach analyse votre présentation…
          </p>
        )}
        {session?.reportStatus && "error" in session.reportStatus && (
          <p className="settings__error">{session.reportStatus.error}</p>
        )}
        {session && !session.reportStatus && session.data.report && (
          <Report session={session} />
        )}
      </div>
      {session && <Discussion session={session} />}
      <p
        className="rehearsal__caption"
        id="rehearsal-caption"
        aria-live="polite"
      >
        {session?.caption}
      </p>
    </section>
  );
}
