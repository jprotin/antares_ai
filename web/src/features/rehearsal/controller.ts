// Répétition d'une présentation (port de rehearsal.js) : discours sur slides (l'IA se
// tait), questions du public joué par l'IA, puis rapport noté lu par l'avatar, que l'on
// peut discuter (la note peut être révisée). Le routeur applique la phase en cours au
// relais vocal (router/rehearsal.py) ; un seul appel couvre le tout. Le bruit ambiant
// est filtré (audio/noiseGate) et le micro est coupé tant que l'avatar parle.
//
// Impératif, hors de React : la séance est un objet mutable ; `version` (store) est
// incrémentée à chaque changement visible et les composants relisent la séance.
import { createStore } from "zustand/vanilla";

import type { CallEngine } from "@/engines/realtime/CallEngine";
import type { CallPlugin } from "@/engines/realtime/plugins";
import type { ServerEvent } from "@/engines/realtime/protocol";
import { deleteResource, getJson } from "@/lib/api";
import { store } from "@/state/store";

import { createNoiseGate } from "./audio/noiseGate";
import {
  CALIBRATION_MS,
  clock,
  holdsMic,
  isActive,
  isFragment,
  isSilent,
  longClock,
  newPart,
  NEXT_LABEL,
  QA_MARKER,
  reportMarker,
  TRANSCRIPT_WAIT_MS,
  type Phase,
} from "./rehearsalMachine";
import type {
  Audience,
  Exchange,
  HistoryItem,
  RehearsalData,
  Segment,
} from "./types";

type Pending = { slide: number; start: number; stopped?: number };

export type Session = {
  data: RehearsalData;
  phase: Phase;
  // Phase affichée (étapes, slides ou rapport) : ne change que par setPhase, comme
  // l'ancienne interface (un rapport en échec repasse en « qa » sans réafficher les slides)
  shownPhase: Phase;
  slide: number;
  startedAt: number;
  segments: Segment[];
  slideTimes: { slide: number; at: number }[];
  // Paroles en cours de transcription (null pour un rapport enregistré)
  pending: Map<string, Pending> | null;
  // Dernière transcription (cumulative) du tour de parole en cours
  heard: string;
  qa: Exchange[];
  reading: symbol | null;
  responseDone: boolean;
  micOpen: boolean;
  // Discussion du rapport à la voix ; `said` : parole en attente de la réponse du coach
  talking: boolean;
  said: string;
  // Affichage
  hint: string;
  caption: string;
  clockText: string;
  clockOver: boolean;
  nextLabel: string;
  nextDisabled: boolean;
  // Rapport : attente de l'analyse, erreur, ou rendu (null)
  reportStatus: { waiting: true } | { error: string } | null;
  // Rendu complet demandé (défilement remis en haut) ; partie lue (surlignée)
  reportKey: number;
  readingSection: string | null;
  discussionOpen: boolean;
  discussionError: string;
  discussionSending: boolean;
  discussionWaiting: boolean;
};

export type SetupState = {
  audiences: Audience[];
  history: HistoryItem[];
  error: string;
  starting: boolean;
};

export type View = { version: number; setup: SetupState };

const wait = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

// Requête JSON tolérante à une réponse vide (comme `send` de rehearsal.js)
async function send<T = Record<string, unknown>>(
  url: string,
  method: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    detail?: string;
  };
  if (!response.ok) throw new Error(data.detail ?? `HTTP ${response.status}`);
  return data;
}

export type CreateForm = {
  title: string;
  pdf: File | null;
  audience: string;
  questions: number;
  goal: string;
  target: number;
};

export class RehearsalController {
  readonly gate = createNoiseGate();
  readonly view = createStore<View>()(() => ({
    version: 0,
    setup: { audiences: [], history: [], error: "", starting: false },
  }));
  session: Session | null = null;
  private ticker = 0;
  private readonly engine: CallEngine;

  constructor(engine: CallEngine) {
    this.engine = engine;
  }

  private bump() {
    this.view.setState((state) => ({ version: state.version + 1 }));
  }

  private setSetup(update: Partial<SetupState>) {
    this.view.setState((state) => ({ setup: { ...state.setup, ...update } }));
  }

  // --- Micro : filtre du bruit, interruption -----------------------------------------

  private setMicOpen(open: boolean) {
    if (!this.session) return;
    this.session.micOpen = open;
    this.engine.setMuted(!open);
  }

  // Répétition : filtre du bruit et détection de parole moins sensible
  private protectMic() {
    this.engine.setInputFilter(this.gate.filter);
    this.engine.setVadThreshold(this.gate.vad());
  }

  private releaseMic() {
    this.engine.setInputFilter(null);
    this.engine.setVadThreshold(null);
    this.engine.setMuted(false);
  }

  private async calibrate(message: string) {
    if (this.session) this.session.hint = message;
    this.bump();
    this.engine.setStatus(message);
    this.setMicOpen(true);
    this.gate.reset();
    await this.gate.calibrate(CALIBRATION_MS);
  }

  interruptAvatar() {
    if (!this.session) return;
    if (this.session.reading) {
      this.stopReading();
      return;
    }
    if (this.engine.inCall()) this.engine.send({ type: "response.cancel" });
    this.engine.stopPlayback();
  }

  setNoiseFilter(name: string) {
    this.gate.setFilter(name);
    if (this.engine.inCall()) this.engine.setVadThreshold(this.gate.vad());
    this.bump();
  }

  // --- Préparation et historique -----------------------------------------------------

  async loadSetup() {
    try {
      const { audiences, history } = await getJson<{
        audiences: Audience[];
        history: HistoryItem[];
      }>("api/rehearsals");
      this.setSetup({ audiences, history });
    } catch (failure) {
      this.setSetup({
        error: `Répétitions indisponibles : ${(failure as Error).message}`,
      });
    }
  }

  openSetup() {
    this.setSetup({ error: "" });
    store.getState().showDialog("rehearsal-setup");
    void this.loadSetup();
  }

  async removeSaved(item: HistoryItem) {
    if (!window.confirm(`Supprimer la répétition « ${item.title} » ?`)) return;
    try {
      await deleteResource(`api/rehearsals/${item.id}`);
      await this.loadSetup();
    } catch (failure) {
      this.setSetup({ error: (failure as Error).message });
    }
  }

  async create(form: CreateForm) {
    this.setSetup({ error: "" });
    if (!form.pdf) {
      this.setSetup({ error: "Choisissez le PDF de vos slides." });
      return;
    }
    const [kind, id] = form.audience.split(":");
    this.setSetup({ starting: true });
    try {
      const created = await send<{ id: string }>("api/rehearsals", "POST", {
        title: form.title.trim(),
        audience: kind === "audience" ? id : "",
        agent: kind === "agent" ? id : "",
        goal: form.goal.trim(),
        target_minutes: form.target || 0,
        questions: form.questions,
      });
      const response = await fetch(`api/rehearsals/${created.id}/slides`, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: form.pdf,
      });
      const data = (await response
        .json()
        .catch(() => ({}))) as RehearsalData & {
        detail?: string;
      };
      if (!response.ok) {
        await fetch(`api/rehearsals/${created.id}`, { method: "DELETE" });
        throw new Error(data.detail ?? `HTTP ${response.status}`);
      }
      store.getState().closeDialog("rehearsal-setup");
      void this.begin(data);
    } catch (failure) {
      this.setSetup({
        error: `Répétition impossible : ${(failure as Error).message}`,
      });
    } finally {
      this.setSetup({ starting: false });
    }
  }

  // --- Panneau -------------------------------------------------------------------------

  private newSession(data: RehearsalData, phase: Phase): Session {
    return {
      data,
      phase,
      shownPhase: phase,
      slide: 0,
      startedAt: 0,
      segments: [],
      slideTimes: [],
      pending: phase === "speech" ? new Map() : null,
      heard: "",
      qa: [],
      reading: null,
      responseDone: false,
      micOpen: false,
      talking: false,
      said: "",
      hint: "",
      caption: "",
      clockText: "0:00",
      clockOver: false,
      nextLabel: NEXT_LABEL[phase],
      nextDisabled: false,
      reportStatus: null,
      reportKey: 0,
      readingSection: null,
      discussionOpen: false,
      discussionError: "",
      discussionSending: false,
      discussionWaiting: false,
    };
  }

  private setPhase(phase: Phase) {
    const session = this.session;
    if (!session) return;
    session.phase = phase;
    session.shownPhase = phase;
    store.getState().setRootData("rehearsal", phase);
    session.nextLabel = NEXT_LABEL[phase];
    session.nextDisabled = phase === "analysis";
    this.bump();
  }

  private hidePanel() {
    window.clearInterval(this.ticker);
    this.ticker = 0;
    this.closeDiscussion();
    store.getState().setRootData("rehearsal", null);
    this.session = null;
    this.bump();
  }

  showSlide(number: number) {
    const session = this.session;
    if (!session) return;
    const total = session.data.slides.length;
    const slide = Math.min(Math.max(1, number), total);
    if (
      slide !== session.slide &&
      session.phase === "speech" &&
      session.startedAt
    ) {
      session.slideTimes.push({ slide, at: this.elapsed() });
    }
    session.slide = slide;
    this.bump();
  }

  private elapsed() {
    return this.session?.startedAt
      ? (performance.now() - this.session.startedAt) / 1000
      : 0;
  }

  private tick = () => {
    const session = this.session;
    if (!session) return;
    const target = (session.data.target_minutes || 0) * 60;
    const seconds = this.elapsed();
    session.clockText = target
      ? `${clock(seconds)} / ${clock(target)}`
      : clock(seconds);
    session.clockOver = Boolean(target) && seconds > target;
    this.bump();
  };

  private async goLive(phase: string) {
    if (!this.session) return;
    await send("api/rehearsals/live", "PUT", {
      id: this.session.data.id,
      phase,
    });
  }

  async begin(data: RehearsalData) {
    const session = this.newSession(data, "speech");
    this.session = session;
    this.setPhase("speech");
    this.showSlide(1);
    session.hint = "Connexion…";
    session.nextDisabled = true;
    this.bump();
    try {
      await this.goLive("speech");
      this.protectMic();
      void this.engine.start({
        replay: false,
        onOpen: async () => {
          await this.calibrate(
            "Restez silencieux 3 secondes : je mesure le bruit de la pièce…",
          );
          if (this.session !== session || !this.engine.inCall()) return;
          session.startedAt = performance.now();
          session.slideTimes = [{ slide: session.slide, at: 0 }];
          this.ticker = window.setInterval(this.tick, 500);
          session.nextDisabled = false;
          session.hint =
            "Je vous écoute sans vous interrompre · ← → pour changer de slide";
          this.bump();
          this.engine.setStatus("Je vous écoute, prenez la parole");
        },
      });
    } catch (failure) {
      session.hint = `Démarrage impossible : ${(failure as Error).message}`;
      this.bump();
    }
  }

  private async finishSpeech() {
    const session = this.session;
    if (!session) return;
    session.nextDisabled = true;
    session.nextLabel = "Fin de la transcription…";
    this.bump();
    const duration = this.elapsed();
    const until = performance.now() + TRANSCRIPT_WAIT_MS;
    while (session.pending?.size && performance.now() < until) await wait(200);
    // Séance quittée ou remplacée pendant l'attente : plus rien à envoyer
    if (this.session !== session) return;
    window.clearInterval(this.ticker);
    this.tick();
    await send(`api/rehearsals/${session.data.id}/talk`, "PUT", {
      duration,
      segments: session.segments,
      slide_times: session.slideTimes,
    });
    if (this.session !== session) return;
    if (!session.segments.length) {
      session.hint = "Aucune parole entendue : vérifiez le micro et reprenez.";
      this.ticker = window.setInterval(this.tick, 500);
      session.nextDisabled = false;
      session.nextLabel = NEXT_LABEL.speech;
      this.bump();
      return;
    }
    await this.goLive("qa");
    this.setPhase("qa");
    session.hint =
      "Le public vous pose ses questions · les slides restent consultables";
    session.caption = "";
    this.bump();
    this.engine.send({
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
    this.engine.send({ type: "response.create" });
  }

  private async finishQuestions() {
    const session = this.session;
    if (!session) return;
    this.setPhase("analysis");
    this.setMicOpen(false);
    session.reportStatus = { waiting: true };
    this.bump();
    this.engine.setStatus("J'analyse votre présentation…");
    try {
      // Pendant l'analyse, un bruit ne doit pas relancer les questions
      await this.goLive("speech");
      await send(`api/rehearsals/${session.data.id}/qa`, "PUT", {
        exchanges: session.qa,
      });
      session.data = await send<RehearsalData>(
        `api/rehearsals/${session.data.id}/report`,
        "POST",
      );
    } catch (failure) {
      if (this.session !== session) return;
      session.reportStatus = {
        error: `Rapport impossible : ${(failure as Error).message}`,
      };
      session.nextDisabled = false;
      session.nextLabel = "Réessayer";
      session.phase = "qa";
      this.setMicOpen(true);
      this.bump();
      return;
    }
    // Un rapport enregistré ouvert entre-temps : ne pas lire celui-ci à sa place
    if (this.session !== session) return;
    this.setPhase("report");
    this.renderReport();
    void this.readReport(0);
  }

  // Rapport rendu de nouveau ; `keepScroll` : position conservée (note révisée)
  private renderReport({ keepScroll = false } = {}) {
    const session = this.session;
    if (!session) return;
    session.reportStatus = null;
    if (!keepScroll) session.reportKey += 1;
    this.bump();
  }

  async next() {
    const session = this.session;
    if (!session) return;
    try {
      if (session.phase === "speech") await this.finishSpeech();
      else if (session.phase === "qa") await this.finishQuestions();
      else if (session.phase === "report") await this.leave();
    } catch (failure) {
      session.hint = `Erreur : ${(failure as Error).message}`;
      session.nextDisabled = false;
      this.bump();
    }
  }

  quit() {
    const unfinished = this.session && this.session.phase !== "report";
    if (unfinished && !window.confirm("Quitter la répétition en cours ?"))
      return;
    void this.leave();
  }

  // --- Discussion du rapport -----------------------------------------------------------

  openDiscussion() {
    const session = this.session;
    if (!session?.data.report) return;
    session.discussionOpen = true;
    session.discussionError = "";
    this.bump();
  }

  closeDiscussion() {
    const session = this.session;
    if (!session) return;
    if (session.talking) this.stopTalking();
    session.discussionOpen = false;
    this.bump();
  }

  // Rapport et discussion à jour (note révisée, réponse du coach)
  // Réponse arrivée pour `session` : ignorée si une autre séance l'a remplacée
  private updated(session: Session, data: RehearsalData) {
    if (this.session !== session) return;
    session.data = data;
    this.renderReport({ keepScroll: true });
  }

  // Message écrit au coach ; false : non traité (le texte est rendu à la saisie)
  async sendWritten(text: string): Promise<boolean> {
    const session = this.session;
    if (!text || !session) return true;
    session.discussionError = "";
    session.discussionSending = true;
    const shown = session.data.discussion ?? [];
    session.data.discussion = [...shown, { role: "user", text, via: "text" }];
    session.discussionWaiting = true;
    this.bump();
    try {
      const done = await send<{ rehearsal: RehearsalData }>(
        `api/rehearsals/${session.data.id}/discussion`,
        "POST",
        { text },
      );
      session.discussionWaiting = false;
      this.updated(session, done.rehearsal);
      return true;
    } catch (failure) {
      session.data.discussion = shown;
      session.discussionWaiting = false;
      session.discussionError = `Message non traité : ${(failure as Error).message}`;
      this.bump();
      return false;
    } finally {
      session.discussionSending = false;
      this.bump();
    }
  }

  private async refreshDiscussion() {
    const session = this.session;
    if (!session) return;
    session.said = "";
    try {
      this.updated(
        session,
        await getJson<RehearsalData>(`api/rehearsals/${session.data.id}`),
      );
    } catch (failure) {
      session.discussionError = `Discussion indisponible : ${(failure as Error).message}`;
      this.bump();
    }
  }

  toggleTalking() {
    if (this.session?.talking) this.stopTalking();
    else void this.startTalking();
  }

  private startVoice() {
    return new Promise<void>((resolve) => {
      void this.engine.start({ replay: false, onOpen: resolve });
    });
  }

  private async startTalking() {
    const session = this.session;
    if (!session) return;
    if (session.reading) this.stopReading();
    session.discussionError = "";
    session.talking = true;
    this.bump();
    try {
      await this.goLive("discussion");
      if (!this.engine.inCall()) {
        this.protectMic();
        await this.startVoice();
      }
      if (!this.gate.calibrated)
        await this.calibrate(
          "Silence 3 secondes : je mesure le bruit de la pièce…",
        );
      if (!this.session?.talking) return;
      this.setMicOpen(true);
      this.engine.setStatus("Je vous écoute");
    } catch (failure) {
      session.talking = false;
      session.discussionError = `Micro indisponible : ${(failure as Error).message}`;
      this.bump();
    }
  }

  private stopTalking() {
    const session = this.session;
    if (!session) return;
    session.talking = false;
    session.said = "";
    this.setMicOpen(false);
    this.goLive("report").catch(() => {});
    this.bump();
  }

  // Après une lecture du rapport, la discussion à la voix reprend
  private async resumeTalking() {
    if (!this.session?.talking || !this.engine.inCall()) return;
    await this.goLive("discussion");
    this.setMicOpen(true);
  }

  // --- Lecture du rapport -----------------------------------------------------------

  private highlight(key: string | null) {
    if (!this.session) return;
    this.session.readingSection = key;
    this.bump();
  }

  toggleListen() {
    if (this.session?.reading === null) void this.readReport(0);
    else this.stopReading();
  }

  // L'avatar lit les parties l'une après l'autre ; la suivante est demandée quand la
  // précédente a fini d'être jouée (surlignage synchrone avec la voix).
  // `only` : cette partie seulement (bouton Écouter d'une section)
  async readReport(from: number, only = false) {
    const session = this.session;
    const script = session?.data.report?.script;
    if (!session || !script) return;
    if (session.reading) this.stopReading();
    const token = Symbol("lecture");
    session.reading = token;
    session.micOpen = false;
    this.engine.setMuted(true);
    await this.goLive("report");
    if (!this.engine.inCall()) {
      this.protectMic();
      await this.startVoice();
    }
    const last = only ? from + 1 : script.length;
    for (let index = from; index < last; index += 1) {
      if (this.session?.reading !== token || !this.engine.inCall()) return;
      this.highlight(script[index]?.section ?? null);
      session.responseDone = false;
      this.engine.send({
        type: "conversation.item.create",
        item: {
          id: `msg_rap${Date.now()}${index}`,
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: reportMarker(index) }],
        },
      });
      this.engine.send({ type: "response.create" });
      while (this.session?.reading === token && this.engine.inCall()) {
        if (session.responseDone && !this.engine.playing()) break;
        await wait(200);
      }
    }
    if (this.session?.reading === token) {
      session.reading = null;
      this.highlight(null);
      this.engine.setStatus("Rapport présenté");
      await this.resumeTalking();
    }
  }

  readSection(key: string) {
    const index =
      this.session?.data.report?.script.findIndex(
        (part) => part.section === key,
      ) ?? -1;
    if (index >= 0) void this.readReport(index, true);
  }

  stopReading() {
    const session = this.session;
    if (!session) return;
    session.reading = null;
    if (this.engine.inCall()) this.engine.send({ type: "response.cancel" });
    this.engine.stopPlayback();
    this.highlight(null);
    void this.resumeTalking();
  }

  async showSaved(id: string) {
    let data: RehearsalData;
    try {
      data = await getJson<RehearsalData>(`api/rehearsals/${id}`);
    } catch (failure) {
      // Fenêtre gardée ouverte pour afficher l'erreur
      this.setSetup({ error: (failure as Error).message });
      return;
    }
    store.getState().closeDialog("rehearsal-setup");
    if (this.session) await this.leave();
    const session = this.newSession(data, "report");
    session.slide = 1;
    session.clockText = longClock(data.report?.metrics.duration ?? 0);
    this.session = session;
    this.setPhase("report");
    this.renderReport();
  }

  async leave() {
    if (this.session) {
      this.session.reading = null;
      // La phase vocale est arrêtée ci-dessous : la discussion ne la relance pas
      this.session.talking = false;
    }
    await fetch("api/rehearsals/live", { method: "DELETE" }).catch(() => {});
    if (this.engine.inCall()) this.engine.hangUp("Répétition terminée");
    this.releaseMic();
    this.hidePanel();
  }

  // --- Événements de l'appel -----------------------------------------------------------

  onEvent(event: ServerEvent) {
    const session = this.session;
    if (!session) return;
    const itemId = typeof event.item_id === "string" ? event.item_id : "last";
    switch (event.type) {
      case "input_audio_buffer.speech_started":
        session.pending?.set(itemId, {
          slide: session.slide,
          start: this.elapsed(),
        });
        break;
      case "input_audio_buffer.speech_stopped": {
        const started = session.pending?.get(itemId);
        if (started) started.stopped = this.elapsed();
        break;
      }
      case "conversation.item.input_audio_transcription.delta":
        if (session.phase !== "report") {
          session.caption = `Vous : ${String(event.delta ?? "")}`;
          this.bump();
        }
        break;
      case "conversation.item.input_audio_transcription.completed": {
        const full = String(event.transcript ?? "").trim();
        if (session.talking) {
          // Discussion du rapport : le routeur la traite, on l'affiche en attendant
          if (full) {
            session.said = full;
            this.bump();
          }
          break;
        }
        if (!session.pending) break;
        const key = session.pending.has(itemId) ? itemId : "last";
        const { stopped, ...started } = session.pending.get(key) ?? {
          slide: session.slide,
          start: this.elapsed(),
        };
        session.pending.delete(key);
        if (!full) break;
        // Bribe isolée : écartée ; si la phrase continue, le tour rouvert la reprend
        const spoken = (stopped ?? this.elapsed()) - started.start;
        if (isFragment(full, spoken, session.phase)) break;
        const text = newPart(session.heard, full);
        session.heard = full;
        if (!text) break;
        session.caption = `Vous : ${text}`;
        const last = session.qa.at(-1);
        if (session.phase === "speech") {
          session.segments.push({ ...started, end: this.elapsed(), text });
        } else if (session.phase === "qa" && last?.role === "user") {
          last.text = `${last.text} ${text}`;
        } else if (session.phase === "qa") {
          session.qa.push({ role: "user", text });
        }
        this.bump();
        break;
      }
      case "response.output_audio_transcript.done": {
        const transcript = String(event.transcript ?? "");
        if (!transcript.trim()) break;
        // Réponse prononcée : le tour de parole suivant repart de zéro
        session.heard = "";
        if (session.phase === "qa") {
          session.qa.push({ role: "assistant", text: transcript.trim() });
        }
        session.caption =
          session.phase === "report"
            ? transcript
            : `${session.data.audience_name} : ${transcript}`;
        this.bump();
        break;
      }
      case "response.done":
        session.responseDone = true;
        if (session.talking && session.said) void this.refreshDiscussion();
        break;
      default:
        break;
    }
  }

  // Branchement sur l'appel (registre : FeatureDef.callPlugin)
  plugin(): CallPlugin {
    const state = () =>
      this.session && {
        phase: this.session.phase,
        reading: Boolean(this.session.reading),
        talking: this.session.talking,
      };
    // Phase oubliée par un onglet fermé en pleine répétition : l'appel suivant parlerait
    fetch("api/rehearsals/live", { method: "DELETE" }).catch(() => {});
    return {
      id: "rehearsal",
      onEvent: (event) => this.onEvent(event),
      active: () => isActive(state()),
      silent: () => isSilent(state()),
      holdMic: () => holdsMic(state()),
      // Appel coupé (serveur, onglet) : la répétition s'arrête là où elle en était
      onCallEnded: () => {
        const session = this.session;
        if (!session) return;
        if (session.reading) session.reading = null;
        if (session.talking) {
          session.talking = false;
          session.said = "";
        }
        if (session.phase === "speech" || session.phase === "qa") {
          window.clearInterval(this.ticker);
          session.hint =
            "Appel interrompu : quittez puis recommencez la répétition.";
        }
        this.bump();
      },
    };
  }
}
