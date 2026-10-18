// Répétition d'une présentation : discours sur slides (l'IA se tait), questions du
// public joué par l'IA, puis rapport noté lu par l'avatar, que l'on peut discuter (la
// note peut être révisée). Le routeur applique la phase en cours au relais vocal (cf.
// router/rehearsal.py) ; un seul appel couvre le tout. Le bruit ambiant est filtré
// (noise-gate.js) et le micro est coupé tant que l'avatar parle.

import { createNoiseGate } from "./noise-gate.js";
import { closeOnBackdrop, getJson } from "./settings.js";

// Repères reconnus par le routeur (rehearsal.QA_MARKER, rehearsal.REPORT_MARKER)
const QA_MARKER = "[Fin du discours]";
const reportMarker = (index) => `[Rapport, partie ${index}]`;
// Fin de discours : dernière phrase encore en cours de transcription
const TRANSCRIPT_WAIT_MS = 4000;
// Mesure du bruit de la pièce, micro ouvert et sans parler
const CALIBRATION_MS = 3000;
// Bribe écartée de l'analyse (souvent un bruit transcrit en « Merci. » ou « Hum ») :
// au plus 2 mots en moins d'une seconde
const FRAGMENT_WORDS = 2;
const FRAGMENT_SECONDS = 1;

const NEXT_LABEL = {
  speech: "J'ai terminé mon discours",
  qa: "Voir le rapport",
  analysis: "Analyse en cours…",
  report: "Terminer",
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function clock(seconds) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function longClock(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return minutes
    ? `${minutes} min ${String(total % 60).padStart(2, "0")} s`
    : `${total} s`;
}

async function send(url, method, body) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail ?? `HTTP ${response.status}`);
  return data;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;

function formatDate(seconds, timeStyle = "short") {
  return new Date(seconds * 1000).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle,
  });
}

// Note de départ de chaque critère révisé
function initialScores(report) {
  const initial = {};
  for (const change of report.revisions ?? []) {
    if (!(change.criterion in initial))
      initial[change.criterion] = change.before;
  }
  return initial;
}

const revised = (report) =>
  report.initial_score !== undefined &&
  report.initial_score !== null &&
  report.initial_score !== report.score;

// Sans réponse de l'IA, le moteur rouvre le même tour de parole (pause de moins de
// 7 s) : chaque transcription reprend tout ce qui a été dit depuis le début du tour.
// Renvoie la seule partie nouvelle ; un tour neuf ne commence pas par les mêmes mots.
const OPENING_WORDS = 4;
// Mot comparé sans casse ni ponctuation (« tous. » puis « tous, » d'une fois à l'autre)
const plainWord = (word) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
// Mots d'une transcription, sans ponctuation isolée (« tous ! Alors »)
const tokens = (text) => text.split(/\s+/).filter((word) => plainWord(word));
function newPart(previous, text) {
  if (!previous) return text;
  if (text.startsWith(previous)) return text.slice(previous.length).trim();
  const before = tokens(previous);
  const words = tokens(text);
  const sameTurn = before
    .slice(0, OPENING_WORDS)
    .every((word, index) => plainWord(word) === plainWord(words[index] ?? ""));
  if (!sameTurn) return text;
  // Début retranscrit autrement : on garde les mots en plus
  return words.slice(before.length).join(" ");
}

/**
 * `voice` : accès à l'appel de l'écran principal (app.js) :
 *   start({ onOpen }), stop(message), inCall(), send(event), setMuted(bool),
 *   playing(), stopPlayback(), setInputFilter(fn), setVadThreshold(value),
 *   setStatus(text).
 */
export function initRehearsal({ voice, agents }) {
  const app = document.querySelector(".app");
  const setup = document.getElementById("rehearsal-setup");
  const form = document.getElementById("rehearsal-form");
  const error = document.getElementById("rehearsal-error");
  const field = {
    title: document.getElementById("rehearsal-title"),
    pdf: document.getElementById("rehearsal-pdf"),
    audience: document.getElementById("rehearsal-audience"),
    questions: document.getElementById("rehearsal-questions"),
    goal: document.getElementById("rehearsal-goal"),
    target: document.getElementById("rehearsal-target"),
  };
  const startButton = document.getElementById("rehearsal-start");
  const historyList = document.getElementById("rehearsal-history");
  const panel = document.getElementById("rehearsal");
  const steps = panel.querySelectorAll("[data-step]");
  const clockView = document.getElementById("rehearsal-clock");
  const next = document.getElementById("rehearsal-next");
  const quit = document.getElementById("rehearsal-quit");
  const slideBox = document.getElementById("rehearsal-slide-box");
  const slideImage = document.getElementById("rehearsal-slide");
  const count = document.getElementById("rehearsal-count");
  const hint = document.getElementById("rehearsal-hint");
  const reportView = document.getElementById("rehearsal-report");
  const caption = document.getElementById("rehearsal-caption");
  const micMeter = document.getElementById("rehearsal-mic");
  const micState = document.getElementById("rehearsal-mic-state");
  const noiseFilter = document.getElementById("rehearsal-noise");
  const interrupt = document.getElementById("rehearsal-interrupt");
  const discussion = {
    panel: document.getElementById("rehearsal-discussion"),
    score: document.getElementById("discussion-score"),
    thread: document.getElementById("discussion-thread"),
    form: document.getElementById("discussion-form"),
    text: document.getElementById("discussion-text"),
    send: document.getElementById("discussion-send"),
    talk: document.getElementById("discussion-talk"),
    close: document.getElementById("discussion-close"),
    error: document.getElementById("discussion-error"),
  };
  const gate = createNoiseGate();
  noiseFilter.value = gate.name;

  // Répétition affichée : { data, phase, slide, startedAt, segments, slideTimes,
  // pending (paroles en cours de transcription), qa, reading, talking (discussion du
  // rapport à la voix), said (parole en attente de la réponse du coach) }
  let current = null;
  let ticker = null;
  let meterFrame = null;

  // --- Micro : filtre du bruit, niveau, interruption ------------------------------

  // Niveau affiché sur une échelle de -60 à 0 dB
  const meterPosition = (rms) =>
    Math.min(1, Math.max(0, (20 * Math.log10(rms || 1e-6) + 60) / 60));

  function updateMeter() {
    if (!current) return;
    const avatar = voice.playing();
    const listening = voice.inCall() && !avatar && current.micOpen;
    micMeter.style.setProperty(
      "--level",
      listening ? meterPosition(gate.level) : 0,
    );
    micMeter.style.setProperty("--threshold", meterPosition(gate.threshold));
    micMeter.classList.toggle("is-voice", listening && gate.open);
    micState.textContent = !voice.inCall()
      ? "Micro inactif"
      : avatar || !current.micOpen
        ? "Micro coupé"
        : gate.open
          ? "Voix captée"
          : "Bruit filtré";
    interrupt.hidden = !avatar;
    meterFrame = window.requestAnimationFrame(updateMeter);
  }

  function setMicOpen(open) {
    current.micOpen = open;
    voice.setMuted(!open);
  }

  // Répétition : filtre du bruit et détection de parole moins sensible
  function protectMic() {
    voice.setInputFilter(gate.filter);
    voice.setVadThreshold(gate.vad());
  }

  function releaseMic() {
    voice.setInputFilter(null);
    voice.setVadThreshold(null);
    voice.setMuted(false);
  }

  async function calibrate(message) {
    hint.textContent = message;
    voice.setStatus(message);
    setMicOpen(true);
    gate.reset();
    await gate.calibrate(CALIBRATION_MS);
  }

  function interruptAvatar() {
    if (!current) return;
    if (current.reading) {
      stopReading();
      return;
    }
    if (voice.inCall()) voice.send({ type: "response.cancel" });
    voice.stopPlayback();
  }

  // --- Préparation ---------------------------------------------------------------

  async function openSetup() {
    error.textContent = "";
    const { audiences, history } = await getJson("api/rehearsals");
    const types = element("optgroup");
    types.label = "Publics types";
    for (const audience of audiences) {
      const option = element("option", "", audience.name);
      option.value = `audience:${audience.id}`;
      types.append(option);
    }
    const mine = element("optgroup");
    mine.label = "Mes agents";
    for (const agent of [...agents()].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const option = element("option", "", agent.name);
      option.value = `agent:${agent.id}`;
      mine.append(option);
    }
    const chosen = field.audience.value;
    field.audience.replaceChildren(
      types,
      ...(mine.children.length ? [mine] : []),
    );
    if (chosen) field.audience.value = chosen;
    renderHistory(history);
    if (!setup.open) setup.showModal();
  }

  // Notes successives d'une même présentation (même titre), de la plus ancienne
  function progression(history, title) {
    return history
      .filter((r) => r.title === title && r.score !== null)
      .reverse()
      .map((r) => r.score);
  }

  function sparkline(scores) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 60 20");
    svg.setAttribute("class", "sparkline");
    svg.setAttribute("aria-hidden", "true");
    const step = scores.length > 1 ? 56 / (scores.length - 1) : 0;
    const points = scores.map((s, i) => [2 + i * step, 18 - (s / 20) * 16]);
    const line = document.createElementNS(ns, "polyline");
    line.setAttribute("points", points.map((p) => p.join(",")).join(" "));
    const last = document.createElementNS(ns, "circle");
    last.setAttribute("cx", points.at(-1)[0]);
    last.setAttribute("cy", points.at(-1)[1]);
    last.setAttribute("r", "2");
    svg.append(line, last);
    return svg;
  }

  function renderHistory(history) {
    if (!history.length) {
      historyList.replaceChildren(
        element("p", "agents__empty", "Aucune répétition pour l'instant."),
      );
      return;
    }
    historyList.replaceChildren(
      ...history.map((item) => {
        const card = element("article", "agent-card");
        const head = element("div", "agent-card__head");
        head.append(element("span", "option__title", item.title));
        if (item.score !== null) {
          head.append(element("span", "badge badge--gpu", `${item.score}/20`));
        }
        const scores = progression(history, item.title);
        if (
          scores.length > 1 &&
          item === history.find((h) => h.title === item.title)
        ) {
          head.append(sparkline(scores));
          head.append(element("span", "option__detail", scores.join(" → ")));
        }
        const date = new Date(item.created * 1000).toLocaleString("fr-FR", {
          dateStyle: "medium",
          timeStyle: "short",
        });
        const detail = element(
          "p",
          "option__detail",
          [
            date,
            item.audience_name,
            `${item.slides} slides`,
            item.duration ? longClock(item.duration) : "discours non fait",
          ].join(" · "),
        );
        const actions = element("div", "agent-card__actions");
        if (item.score !== null) {
          const show = element("button", "preview-button", "Rapport");
          show.type = "button";
          show.addEventListener("click", () => showSaved(item.id));
          actions.append(show);
        }
        const remove = element("button", "preview-button", "Supprimer");
        remove.type = "button";
        remove.addEventListener("click", async () => {
          if (!window.confirm(`Supprimer la répétition « ${item.title} » ?`))
            return;
          await fetch(`api/rehearsals/${item.id}`, { method: "DELETE" });
          openSetup();
        });
        actions.append(remove);
        card.append(head, detail, actions);
        return card;
      }),
    );
  }

  async function create(event) {
    event.preventDefault();
    error.textContent = "";
    const pdf = field.pdf.files[0];
    if (!pdf) {
      error.textContent = "Choisissez le PDF de vos slides.";
      return;
    }
    const [kind, id] = field.audience.value.split(":");
    startButton.disabled = true;
    startButton.textContent = "Préparation des slides…";
    try {
      const created = await send("api/rehearsals", "POST", {
        title: field.title.value.trim(),
        audience: kind === "audience" ? id : "",
        agent: kind === "agent" ? id : "",
        goal: field.goal.value.trim(),
        target_minutes: Number(field.target.value) || 0,
        questions: Number(field.questions.value),
      });
      const response = await fetch(`api/rehearsals/${created.id}/slides`, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: pdf,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        await fetch(`api/rehearsals/${created.id}`, { method: "DELETE" });
        throw new Error(data.detail ?? `HTTP ${response.status}`);
      }
      setup.close();
      begin(data);
    } catch (failure) {
      error.textContent = `Répétition impossible : ${failure.message}`;
    } finally {
      startButton.disabled = false;
      startButton.textContent = "Commencer";
    }
  }

  // --- Panneau ---------------------------------------------------------------------

  function setPhase(phase) {
    current.phase = phase;
    app.dataset.rehearsal = phase;
    const order = ["speech", "qa", "report"];
    const reached = order.indexOf(phase === "analysis" ? "report" : phase);
    steps.forEach((step, index) => {
      step.classList.toggle("is-done", index < reached);
      step.classList.toggle("is-current", index === reached);
    });
    next.textContent = NEXT_LABEL[phase];
    next.disabled = phase === "analysis";
    slideBox.hidden = phase === "report" || phase === "analysis";
    reportView.hidden = !slideBox.hidden;
  }

  function showPanel() {
    panel.hidden = false;
    caption.textContent = "";
    window.cancelAnimationFrame(meterFrame);
    meterFrame = window.requestAnimationFrame(updateMeter);
  }

  function hidePanel() {
    window.clearInterval(ticker);
    ticker = null;
    window.cancelAnimationFrame(meterFrame);
    meterFrame = null;
    closeDiscussion();
    panel.hidden = true;
    delete app.dataset.rehearsal;
    current = null;
  }

  function showSlide(number) {
    const total = current.data.slides.length;
    const slide = Math.min(Math.max(1, number), total);
    if (
      slide !== current.slide &&
      current.phase === "speech" &&
      current.startedAt
    ) {
      current.slideTimes.push({ slide, at: elapsed() });
    }
    current.slide = slide;
    slideImage.src = `api/rehearsals/${current.data.id}/slides/${slide}`;
    slideImage.alt = `Slide ${slide}`;
    count.textContent = `${slide} / ${total}`;
  }

  function elapsed() {
    return current?.startedAt
      ? (performance.now() - current.startedAt) / 1000
      : 0;
  }

  function tick() {
    if (!current) return;
    const target = (current.data.target_minutes || 0) * 60;
    const seconds = elapsed();
    clockView.textContent = target
      ? `${clock(seconds)} / ${clock(target)}`
      : clock(seconds);
    clockView.classList.toggle("is-over", Boolean(target) && seconds > target);
  }

  async function goLive(phase) {
    await send("api/rehearsals/live", "PUT", { id: current.data.id, phase });
  }

  async function begin(data) {
    current = {
      data,
      phase: "speech",
      slide: 0,
      startedAt: 0,
      segments: [],
      slideTimes: [],
      pending: new Map(),
      // Dernière transcription (cumulative) du tour de parole en cours
      heard: "",
      qa: [],
      reading: null,
      micOpen: false,
      talking: false,
      said: "",
    };
    showPanel();
    setPhase("speech");
    showSlide(1);
    hint.textContent = "Connexion…";
    next.disabled = true;
    try {
      await goLive("speech");
      protectMic();
      voice.start({
        replay: false,
        onOpen: async () => {
          await calibrate(
            "Restez silencieux 3 secondes : je mesure le bruit de la pièce…",
          );
          if (!current || !voice.inCall()) return;
          current.startedAt = performance.now();
          current.slideTimes = [{ slide: current.slide, at: 0 }];
          ticker = window.setInterval(tick, 500);
          next.disabled = false;
          hint.textContent =
            "Je vous écoute sans vous interrompre · ← → pour changer de slide";
          voice.setStatus("Je vous écoute, prenez la parole");
        },
      });
    } catch (failure) {
      hint.textContent = `Démarrage impossible : ${failure.message}`;
    }
  }

  async function finishSpeech() {
    next.disabled = true;
    next.textContent = "Fin de la transcription…";
    const duration = elapsed();
    const until = performance.now() + TRANSCRIPT_WAIT_MS;
    while (current.pending.size && performance.now() < until) await wait(200);
    window.clearInterval(ticker);
    tick();
    await send(`api/rehearsals/${current.data.id}/talk`, "PUT", {
      duration,
      segments: current.segments,
      slide_times: current.slideTimes,
    });
    if (!current.segments.length) {
      hint.textContent =
        "Aucune parole entendue : vérifiez le micro et reprenez.";
      ticker = window.setInterval(tick, 500);
      next.disabled = false;
      next.textContent = NEXT_LABEL.speech;
      return;
    }
    await goLive("qa");
    setPhase("qa");
    hint.textContent =
      "Le public vous pose ses questions · les slides restent consultables";
    caption.textContent = "";
    voice.send({
      type: "conversation.item.create",
      item: {
        id: `msg_rep${Date.now()}`,
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `${QA_MARKER} J'ai terminé ma présentation.`,
          },
        ],
      },
    });
    voice.send({ type: "response.create" });
  }

  async function finishQuestions() {
    setPhase("analysis");
    setMicOpen(false);
    reportView.replaceChildren(
      element("p", "report__waiting", "Le coach analyse votre présentation…"),
    );
    voice.setStatus("J'analyse votre présentation…");
    try {
      // Pendant l'analyse, un bruit ne doit pas relancer les questions
      await goLive("speech");
      await send(`api/rehearsals/${current.data.id}/qa`, "PUT", {
        exchanges: current.qa,
      });
      current.data = await send(
        `api/rehearsals/${current.data.id}/report`,
        "POST",
      );
    } catch (failure) {
      reportView.replaceChildren(
        element(
          "p",
          "settings__error",
          `Rapport impossible : ${failure.message}`,
        ),
      );
      next.disabled = false;
      next.textContent = "Réessayer";
      current.phase = "qa";
      setMicOpen(true);
      return;
    }
    setPhase("report");
    renderReport();
    readReport(0);
  }

  // --- Rapport ---------------------------------------------------------------------

  function section(key, title) {
    const node = element("section", "report__section");
    node.dataset.section = key;
    const heading = element("h3", "", title);
    const play = element("button", "report__play", "Écouter");
    play.type = "button";
    play.title = "Faire lire cette partie par l'avatar";
    play.addEventListener("click", () => {
      const index = current.data.report.script.findIndex(
        (part) => part.section === key,
      );
      if (index >= 0) readReport(index, true);
    });
    heading.append(play);
    node.append(heading);
    return node;
  }

  function slideChip(number) {
    const chip = element("button", "report__chip", `Slide ${number}`);
    chip.type = "button";
    chip.addEventListener("click", () => {
      const viewer = element("dialog", "settings report__viewer");
      const image = element("img");
      image.src = `api/rehearsals/${current.data.id}/slides/${number}`;
      image.alt = `Slide ${number}`;
      viewer.append(image);
      document.body.append(viewer);
      closeOnBackdrop(viewer);
      viewer.addEventListener("click", () => viewer.close());
      viewer.addEventListener("close", () => viewer.remove());
      viewer.showModal();
    });
    return chip;
  }

  function renderReport({ keepScroll = false } = {}) {
    const { data } = current;
    const report = data.report;
    const measured = report.metrics;
    const initial = initialScores(report);
    const scroll = reportView.scrollTop;
    const parts = [];

    const head = element("header", "report__head");
    const title = element("div");
    title.append(
      element("h2", "", data.title),
      element(
        "p",
        "report__meta",
        `${data.audience_name} · ${new Date(
          report.created * 1000,
        ).toLocaleString("fr-FR", {
          dateStyle: "long",
          timeStyle: "short",
        })}`,
      ),
    );
    const controls = element("div", "report__controls");
    const listen = element("button", "button-ghost report__listen", "Écouter");
    listen.type = "button";
    listen.addEventListener("click", () =>
      current.reading === null ? readReport(0) : stopReading(),
    );
    const discuss = element("button", "button-ghost", "Discuter de la note");
    discuss.type = "button";
    discuss.addEventListener("click", openDiscussion);
    const print = element("button", "button-ghost", "Imprimer / PDF");
    print.type = "button";
    print.addEventListener("click", () => window.print());
    controls.append(listen, discuss, print);
    head.append(title, controls);
    parts.push(head);

    const score = section("score", "Note");
    const ring = element("div", "report__score");
    ring.style.setProperty("--score", report.score / report.out_of);
    ring.append(
      element("strong", "", report.score),
      element("span", "", `/ ${report.out_of}`),
    );
    const verdict = element("div", "report__verdict");
    verdict.append(element("p", "", report.verdict));
    const grid = element("ul", "report__criteria");
    for (const criterion of report.criteria) {
      const row = element("li");
      const bar = element("span", "report__bar");
      bar.style.setProperty("--value", criterion.score / criterion.max);
      const value = element(
        "span",
        "report__value",
        `${criterion.score}/${criterion.max}`,
      );
      const before = initial[criterion.key];
      if (before !== undefined && before !== criterion.score) {
        const delta = criterion.score - before;
        value.append(
          element(
            "span",
            `report__delta ${delta > 0 ? "is-up" : "is-down"}`,
            delta > 0 ? `+${delta}` : String(delta),
          ),
        );
        value.title = `Initialement ${before}/${criterion.max}`;
      }
      row.append(
        element("span", "report__label", criterion.label),
        bar,
        value,
        element("span", "report__comment", criterion.comment),
      );
      grid.append(row);
    }
    verdict.append(grid);
    if (report.revisions?.length) {
      const line = element("p", "report__revised");
      const count = report.revisions.length;
      line.append(
        revised(report)
          ? `Note révisée (initialement ${report.initial_score}/${report.out_of}) · `
          : `${count} révision${count > 1 ? "s" : ""}, note inchangée · `,
      );
      const open = element("button", "link-button", "Voir l'historique");
      open.type = "button";
      open.addEventListener("click", showDiscussionHistory);
      line.append(open);
      verdict.append(line);
    }
    score.append(ring, verdict);
    parts.push(score);

    if (report.strengths.length) {
      const strengths = section("strengths", "Points forts");
      const list = element("ul", "report__list report__list--good");
      for (const item of report.strengths) list.append(element("li", "", item));
      strengths.append(list);
      parts.push(strengths);
    }

    if (report.improvements.length) {
      const improve = section("improvements", "À améliorer, pas à pas");
      const list = element("ol", "report__steps");
      for (const item of report.improvements) {
        const step = element("li");
        const issue = element("p", "report__issue");
        if (item.slide) issue.append(slideChip(item.slide), " ");
        issue.append(item.issue);
        step.append(issue);
        if (item.advice)
          step.append(element("p", "report__advice", item.advice));
        list.append(step);
      }
      improve.append(list);
      parts.push(improve);
    }

    if (report.avoid.length) {
      const avoid = section("avoid", "À ne pas dire");
      for (const item of report.avoid) {
        const card = element("article", "report__quote");
        card.append(element("blockquote", "report__said", `« ${item.quote} »`));
        if (item.why) card.append(element("p", "report__why", item.why));
        if (item.instead) {
          const better = element("p", "report__instead");
          better.append(
            element("strong", "", "Dites plutôt : "),
            `« ${item.instead} »`,
          );
          card.append(better);
        }
        avoid.append(card);
      }
      parts.push(avoid);
    }

    if (report.answers.length) {
      const answers = section("answers", "Questions-réponses");
      for (const item of report.answers) {
        const card = element("article", "report__qa");
        card.append(element("p", "report__question", item.question));
        if (item.assessment)
          card.append(element("p", "report__why", item.assessment));
        if (item.better) {
          const better = element("p", "report__instead");
          better.append(
            element("strong", "", "Réponse possible : "),
            item.better,
          );
          card.append(better);
        }
        answers.append(card);
      }
      parts.push(answers);
    }

    const pace = section("metrics", "Rythme et temps");
    const figures = element("dl", "report__figures");
    const figure = (label, value, warn = false) => {
      const box = element("div", warn ? "is-warn" : "");
      box.append(element("dt", "", label), element("dd", "", value));
      figures.append(box);
    };
    const over =
      measured.target_seconds && measured.duration - measured.target_seconds;
    figure(
      "Durée",
      measured.target_seconds
        ? `${longClock(measured.duration)} / ${longClock(measured.target_seconds)}`
        : longClock(measured.duration),
      Math.abs(over) >= 60,
    );
    figure(
      "Débit",
      `${measured.words_per_minute} mots/min`,
      measured.words_per_minute < 110 || measured.words_per_minute > 170,
    );
    figure("Mots", String(measured.words));
    if (Object.keys(measured.fillers).length) {
      figure(
        "Mots qui reviennent",
        Object.entries(measured.fillers)
          .slice(0, 3)
          .map(([word, n]) => `${word} ×${n}`)
          .join(", "),
        true,
      );
    }
    pace.append(figures);
    const longest = Math.max(...measured.per_slide.map((s) => s.seconds), 1);
    const bars = element("ul", "report__slides");
    for (const slide of measured.per_slide) {
      const row = element("li");
      if (measured.skipped.includes(slide.slide)) row.classList.add("is-warn");
      const bar = element("span", "report__bar");
      bar.style.setProperty("--value", slide.seconds / longest);
      row.append(
        element("span", "report__label", `Slide ${slide.slide}`),
        bar,
        element("span", "report__value", longClock(slide.seconds)),
      );
      bars.append(row);
    }
    pace.append(bars);
    parts.push(pace);

    // Annexe imprimée : les révisions de la note, sans le fil de la discussion
    if (report.revisions?.length) {
      const annex = element("section", "report__section report__annex");
      annex.append(element("h3", "", "Annexe · révisions de la note"));
      annex.append(revisionList(report));
      parts.push(annex);
    }

    reportView.replaceChildren(...parts);
    reportView.scrollTop = keepScroll ? scroll : 0;
  }

  function revisionList(report) {
    const list = element("ol", "revisions");
    for (const change of report.revisions ?? []) {
      const item = element("li");
      const head = element("p", "revisions__head");
      head.append(
        element("strong", "", change.label),
        ` ${change.before} → ${change.after} sur ${report.criteria[0]?.max ?? 4}`,
        element("span", "revisions__date", formatDate(change.at)),
      );
      item.append(head);
      if (change.reason)
        item.append(element("p", "revisions__reason", change.reason));
      list.append(item);
    }
    return list;
  }

  // --- Discussion du rapport ------------------------------------------------------

  function scoreLabel(report) {
    return revised(report)
      ? `${report.score}/${report.out_of} · initialement ${report.initial_score}/${report.out_of}`
      : `${report.score}/${report.out_of}`;
  }

  function bubble(message) {
    const node = element(
      "div",
      `discussion__message discussion__message--${message.role}`,
    );
    node.append(element("p", "", message.text));
    for (const change of message.revisions ?? []) {
      node.append(
        element(
          "span",
          `discussion__change ${change.after > change.before ? "is-up" : "is-down"}`,
          `${change.label} : ${change.before} → ${change.after}`,
        ),
      );
    }
    if (message.via === "voice")
      node.append(element("span", "discussion__via", "à l'oral"));
    return node;
  }

  function renderDiscussion() {
    if (!current?.data.report || discussion.panel.hidden) return;
    discussion.score.textContent = scoreLabel(current.data.report);
    const messages = current.data.discussion ?? [];
    const nodes = messages.map(bubble);
    if (!messages.length && !current.said) {
      nodes.push(
        element(
          "p",
          "discussion__empty",
          "Expliquez un contexte que le coach ignorait ou signalez une erreur " +
            "de sa part : il peut revoir une note d'un point par critère, à la " +
            "hausse comme à la baisse. Une simple contestation ne change rien.",
        ),
      );
    }
    if (current.said) {
      nodes.push(
        bubble({ role: "user", text: current.said, via: "voice" }),
        element("p", "discussion__waiting", "Le coach réfléchit…"),
      );
    }
    discussion.thread.replaceChildren(...nodes);
    discussion.thread.scrollTop = discussion.thread.scrollHeight;
    discussion.talk.setAttribute("aria-pressed", String(current.talking));
    discussion.talk.textContent = current.talking
      ? "Couper le micro"
      : "Parler";
  }

  function openDiscussion() {
    if (!current?.data.report) return;
    discussion.panel.hidden = false;
    panel.classList.add("is-discussing");
    discussion.error.textContent = "";
    renderDiscussion();
    discussion.text.focus();
  }

  function closeDiscussion() {
    if (current?.talking) stopTalking();
    discussion.panel.hidden = true;
    panel.classList.remove("is-discussing");
  }

  // Rapport et discussion à jour (note révisée, réponse du coach)
  function updated(data) {
    current.data = data;
    renderReport({ keepScroll: true });
    renderDiscussion();
  }

  async function sendWritten(event) {
    event.preventDefault();
    const text = discussion.text.value.trim();
    if (!text || !current) return;
    discussion.error.textContent = "";
    discussion.send.disabled = true;
    const shown = current.data.discussion ?? [];
    current.data.discussion = [...shown, { role: "user", text, via: "text" }];
    renderDiscussion();
    discussion.thread.append(
      element("p", "discussion__waiting", "Le coach réfléchit…"),
    );
    discussion.text.value = "";
    try {
      const done = await send(
        `api/rehearsals/${current.data.id}/discussion`,
        "POST",
        { text },
      );
      updated(done.rehearsal);
    } catch (failure) {
      current.data.discussion = shown;
      discussion.text.value = text;
      renderDiscussion();
      discussion.error.textContent = `Message non traité : ${failure.message}`;
    } finally {
      discussion.send.disabled = false;
    }
  }

  async function refreshDiscussion() {
    current.said = "";
    try {
      updated(await getJson(`api/rehearsals/${current.data.id}`));
    } catch (failure) {
      discussion.error.textContent = `Discussion indisponible : ${failure.message}`;
    }
  }

  async function startTalking() {
    if (current.reading) stopReading();
    discussion.error.textContent = "";
    current.talking = true;
    renderDiscussion();
    try {
      await goLive("discussion");
      if (!voice.inCall()) {
        protectMic();
        await new Promise((resolve) =>
          voice.start({ replay: false, onOpen: resolve }),
        );
      }
      if (!gate.calibrated)
        await calibrate("Silence 3 secondes : je mesure le bruit de la pièce…");
      if (!current?.talking) return;
      setMicOpen(true);
      voice.setStatus("Je vous écoute");
    } catch (failure) {
      current.talking = false;
      renderDiscussion();
      discussion.error.textContent = `Micro indisponible : ${failure.message}`;
    }
  }

  function stopTalking() {
    current.talking = false;
    current.said = "";
    setMicOpen(false);
    goLive("report").catch(() => {});
    renderDiscussion();
  }

  // Après une lecture du rapport, la discussion à la voix reprend
  async function resumeTalking() {
    if (!current?.talking || !voice.inCall()) return;
    await goLive("discussion");
    setMicOpen(true);
  }

  function showDiscussionHistory() {
    const report = current.data.report;
    const dialog = element("dialog", "settings discussion-history");
    const header = element("header", "settings__header dialog__header");
    header.append(
      element("h2", "", "Historique de la note"),
      element(
        "p",
        "",
        revised(report)
          ? `Note actuelle ${report.score}/${report.out_of}, initialement ${report.initial_score}/${report.out_of}.`
          : `Note actuelle ${report.score}/${report.out_of}.`,
      ),
    );
    const body = element("div", "discussion-history__body");
    body.append(element("h3", "", "Révisions"), revisionList(report));
    body.append(element("h3", "", "Échanges"));
    const thread = element("div", "discussion__thread");
    thread.append(...(current.data.discussion ?? []).map(bubble));
    body.append(thread);
    const footer = element("footer", "settings__actions dialog__footer");
    const close = element("button", "button-primary", "Fermer");
    close.type = "button";
    close.addEventListener("click", () => dialog.close());
    footer.append(close);
    const content = element("div", "settings__form");
    content.append(header, body, footer);
    dialog.append(content);
    document.body.append(dialog);
    closeOnBackdrop(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  }

  function highlight(key) {
    for (const node of reportView.querySelectorAll(".report__section")) {
      const active = node.dataset.section === key;
      node.classList.toggle("is-reading", active);
      if (active) node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    const listen = reportView.querySelector(".report__listen");
    if (listen) listen.textContent = key ? "Arrêter la lecture" : "Écouter";
  }

  // L'avatar lit les parties l'une après l'autre ; la suivante est demandée quand la
  // précédente a fini d'être jouée (surlignage synchrone avec la voix).
  // `only` : cette partie seulement (bouton Écouter d'une section)
  async function readReport(from, only = false) {
    const script = current.data.report.script;
    if (current.reading) stopReading();
    const token = Symbol("lecture");
    current.reading = token;
    current.micOpen = false;
    voice.setMuted(true);
    await goLive("report");
    if (!voice.inCall()) {
      protectMic();
      await new Promise((resolve) =>
        voice.start({ replay: false, onOpen: resolve }),
      );
    }
    const last = only ? from + 1 : script.length;
    for (let index = from; index < last; index += 1) {
      if (current?.reading !== token || !voice.inCall()) return;
      highlight(script[index].section);
      current.responseDone = false;
      voice.send({
        type: "conversation.item.create",
        item: {
          id: `msg_rap${Date.now()}${index}`,
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: reportMarker(index) }],
        },
      });
      voice.send({ type: "response.create" });
      while (current?.reading === token && voice.inCall()) {
        if (current.responseDone && !voice.playing()) break;
        await wait(200);
      }
    }
    if (current?.reading === token) {
      current.reading = null;
      highlight(null);
      voice.setStatus("Rapport présenté");
      await resumeTalking();
    }
  }

  function stopReading() {
    if (!current) return;
    current.reading = null;
    if (voice.inCall()) voice.send({ type: "response.cancel" });
    voice.stopPlayback();
    highlight(null);
    resumeTalking();
  }

  async function showSaved(id) {
    setup.close();
    if (current) await leave();
    const data = await getJson(`api/rehearsals/${id}`);
    current = {
      data,
      phase: "report",
      slide: 1,
      segments: [],
      qa: [],
      reading: null,
      micOpen: false,
      talking: false,
      said: "",
    };
    showPanel();
    setPhase("report");
    clockView.textContent = longClock(data.report.metrics.duration);
    renderReport();
  }

  async function leave() {
    if (current) {
      current.reading = null;
      // La phase vocale est arrêtée ci-dessous : la discussion ne la relance pas
      current.talking = false;
    }
    await fetch("api/rehearsals/live", { method: "DELETE" }).catch(() => {});
    if (voice.inCall()) voice.stop("Répétition terminée");
    releaseMic();
    hidePanel();
  }

  // --- Événements de l'appel (relayés par app.js) ---------------------------------

  function onEvent(event) {
    if (!current) return;
    switch (event.type) {
      case "input_audio_buffer.speech_started":
        current.pending?.set(event.item_id ?? "last", {
          slide: current.slide,
          start: elapsed(),
        });
        break;
      case "input_audio_buffer.speech_stopped": {
        const started = current.pending?.get(event.item_id ?? "last");
        if (started) started.stopped = elapsed();
        break;
      }
      case "conversation.item.input_audio_transcription.delta":
        if (current.phase !== "report")
          caption.textContent = `Vous : ${event.delta}`;
        break;
      case "conversation.item.input_audio_transcription.completed": {
        const full = event.transcript?.trim();
        if (current.talking) {
          // Discussion du rapport : le routeur la traite, on l'affiche en attendant
          if (full) {
            current.said = full;
            renderDiscussion();
          }
          break;
        }
        if (!current.pending) break;
        const key = current.pending.has(event.item_id) ? event.item_id : "last";
        const { stopped, ...started } = current.pending.get(key) ?? {
          slide: current.slide,
          start: elapsed(),
        };
        current.pending.delete(key);
        if (!full) break;
        // Bribe isolée : écartée ; si la phrase continue, le tour rouvert la reprend
        const spoken = (stopped ?? elapsed()) - started.start;
        if (
          wordCount(full) <= FRAGMENT_WORDS &&
          spoken < FRAGMENT_SECONDS &&
          (current.phase === "speech" || current.phase === "qa")
        ) {
          break;
        }
        const text = newPart(current.heard, full);
        current.heard = full;
        if (!text) break;
        caption.textContent = `Vous : ${text}`;
        const last = current.qa.at(-1);
        if (current.phase === "speech") {
          current.segments.push({ ...started, end: elapsed(), text });
        } else if (current.phase === "qa" && last?.role === "user") {
          last.text = `${last.text} ${text}`;
        } else if (current.phase === "qa") {
          current.qa.push({ role: "user", text });
        }
        break;
      }
      case "response.output_audio_transcript.done":
        if (!event.transcript?.trim()) break;
        // Réponse prononcée : le tour de parole suivant repart de zéro
        current.heard = "";
        if (current.phase === "qa") {
          current.qa.push({ role: "assistant", text: event.transcript.trim() });
        }
        caption.textContent = `${current.data.audience_name} : ${event.transcript}`;
        if (current.phase === "report") caption.textContent = event.transcript;
        break;
      case "response.done":
        current.responseDone = true;
        if (current.talking && current.said) refreshDiscussion();
        break;
      default:
        break;
    }
  }

  // --- Commandes -------------------------------------------------------------------

  next.addEventListener("click", async () => {
    if (!current) return;
    try {
      if (current.phase === "speech") await finishSpeech();
      else if (current.phase === "qa") await finishQuestions();
      else if (current.phase === "report") await leave();
    } catch (failure) {
      hint.textContent = `Erreur : ${failure.message}`;
      next.disabled = false;
    }
  });
  quit.addEventListener("click", () => {
    const unfinished = current && current.phase !== "report";
    if (unfinished && !window.confirm("Quitter la répétition en cours ?"))
      return;
    leave();
  });
  document
    .getElementById("rehearsal-prev")
    .addEventListener("click", () => showSlide(current.slide - 1));
  document
    .getElementById("rehearsal-forward")
    .addEventListener("click", () => showSlide(current.slide + 1));
  slideImage.addEventListener("click", (event) => {
    const { left, width } = slideImage.getBoundingClientRect();
    showSlide(current.slide + (event.clientX - left < width / 3 ? -1 : 1));
  });
  document.addEventListener("keydown", (event) => {
    if (!current || slideBox.hidden || document.querySelector("dialog[open]"))
      return;
    if (event.target.closest("input, textarea, select")) return;
    const forward = ["ArrowRight", "PageDown", " ", "ArrowDown"];
    const back = ["ArrowLeft", "PageUp", "ArrowUp"];
    if (forward.includes(event.key)) showSlide(current.slide + 1);
    else if (back.includes(event.key)) showSlide(current.slide - 1);
    else return;
    event.preventDefault();
  });

  interrupt.addEventListener("click", interruptAvatar);
  noiseFilter.addEventListener("change", () => {
    gate.setFilter(noiseFilter.value);
    if (voice.inCall()) voice.setVadThreshold(gate.vad());
  });
  discussion.form.addEventListener("submit", sendWritten);
  discussion.text.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      discussion.form.requestSubmit();
    }
  });
  discussion.talk.addEventListener("click", () =>
    current?.talking ? stopTalking() : startTalking(),
  );
  discussion.close.addEventListener("click", closeDiscussion);

  document.getElementById("open-rehearsal").addEventListener("click", () =>
    openSetup().catch((failure) => {
      error.textContent = `Répétitions indisponibles : ${failure.message}`;
      setup.showModal();
    }),
  );
  document
    .getElementById("rehearsal-cancel")
    .addEventListener("click", () => setup.close());
  closeOnBackdrop(setup);
  form.addEventListener("submit", create);
  field.pdf.addEventListener("change", () => {
    const pdf = field.pdf.files[0];
    if (pdf && !field.title.value.trim()) {
      field.title.value = pdf.name
        .replace(/\.pdf$/i, "")
        .replace(/[_-]+/g, " ");
    }
  });

  // Phase oubliée par un onglet fermé en pleine répétition : l'appel suivant parlerait
  fetch("api/rehearsals/live", { method: "DELETE" }).catch(() => {});

  return {
    active: () =>
      (Boolean(current) && current.phase !== "report") ||
      Boolean(current?.reading) ||
      Boolean(current?.talking),
    silent: () => current?.phase === "speech" || current?.phase === "analysis",
    // Micro coupé tant que l'avatar parle (questions, rapport, discussion)
    holdMic: () => Boolean(current) && current.phase !== "speech",
    onEvent,
    // Appel coupé (serveur, onglet) : la répétition s'arrête là où elle en était
    onCallEnded() {
      if (!current) return;
      if (current.reading) current.reading = null;
      if (current.talking) {
        current.talking = false;
        current.said = "";
        renderDiscussion();
      }
      if (current.phase === "speech" || current.phase === "qa") {
        window.clearInterval(ticker);
        hint.textContent =
          "Appel interrompu : quittez puis recommencez la répétition.";
      }
    },
  };
}
