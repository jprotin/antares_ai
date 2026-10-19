// Appel temps réel et réponse écrite (port de app.js) : micro -> serveur Realtime
// (WebSocket) -> voix + sous-titres ; hors appel, réponse écrite en flux (SSE).
// Impératif, sans React : lit et écrit le store, pilote l'avatar par appels directs.
// L'appel ne démarre que sur un clic (start), une seule session à la fois.
import { failureReason, httpError } from "@/lib/api";
import { base64FromPcm, floatFromBase64Pcm } from "@/lib/pcm";
import { instructionsFor, writtenInstructionsFor } from "@/lib/persona";
import { readChatStream } from "@/lib/sse";
import { fencedCode, lastTurn } from "@/lib/turn";
import { watchSearch } from "@/engines/net/netMonitor";
import { STATUS_TEXT, type CallState } from "@/state/slices/call";
import { recentHistory } from "@/state/slices/conversation";
import { currentVoice } from "@/state/slices/profile";
import type { AppState } from "@/state/store";
import type { StoreApi } from "zustand/vanilla";

import { Playback } from "./playback";
import { PluginHost } from "./plugins";
import {
  appendAudio,
  DEFAULT_VAD_THRESHOLD,
  messageItem,
  realtimeUrl,
  responseCreate,
  SAMPLE_RATE,
  sessionUpdate,
  type ServerEvent,
} from "./protocol";
import { createVoiceEffect, type VoiceEffect } from "./voiceEffects";

export type AvatarLike = {
  setState(state: string): void;
  setLevel(level: number): void;
};

type ActiveCall = {
  ctx: AudioContext;
  mic: MediaStream;
  ws: WebSocket;
  capture: AudioWorkletNode;
  micAnalyser: AnalyserNode;
  outputAnalyser: AnalyserNode;
  voiceEffect: VoiceEffect;
  playback: Playback;
  state: CallState;
  responseDone: boolean;
  pendingTextResponse: boolean;
  firstAudioPending: boolean;
  speechStoppedAt: number;
  speechStoppedEpoch: number;
  latency: number | null;
  lastAssistantLine?: string;
  levelData: Float32Array<ArrayBuffer>;
  frame: number;
};

type Filter = (block: ArrayBuffer) => ArrayBuffer[];

export class CallEngine {
  readonly plugins = new PluginHost();
  private call: ActiveCall | null = null;
  // Démarrage en cours (micro, worklet) : un second start() est ignoré
  private starting = false;
  private speaker: HTMLAudioElement | null = null;
  // Micro coupé côté envoi (lecture du rapport de répétition)
  private micMuted = false;
  // Filtre appliqué au son du micro avant envoi (bruit ambiant pendant une répétition)
  private inputFilter: Filter | null = null;
  // Seuil de détection de parole, envoyé à chaque appel
  private vadThreshold = DEFAULT_VAD_THRESHOLD;
  private stopSearchWatch: (() => void) | null = null;
  private readonly store: StoreApi<AppState>;
  private readonly avatar: AvatarLike;

  constructor(store: StoreApi<AppState>, avatar: AvatarLike) {
    this.store = store;
    this.avatar = avatar;
  }

  private get state() {
    return this.store.getState();
  }

  // Sortie via un <audio> (et non ctx.destination) : le navigateur l'utilise comme
  // référence d'annulation d'écho, ce qui permet de couper la parole à l'assistant.
  attachSpeaker(element: HTMLAudioElement | null) {
    this.speaker = element;
  }

  inCall(): boolean {
    return this.call?.ws.readyState === WebSocket.OPEN;
  }

  playing(): boolean {
    return Boolean(this.call?.playback.playing);
  }

  send(event: object) {
    this.call?.ws.send(JSON.stringify(event));
  }

  setMuted(muted: boolean) {
    this.micMuted = muted;
  }

  setInputFilter(filter: Filter | null) {
    this.inputFilter = filter;
  }

  // Seuil de détection de parole ; null : celui par défaut
  setVadThreshold(threshold: number | null) {
    this.vadThreshold = threshold ?? DEFAULT_VAD_THRESHOLD;
    if (!this.inCall()) return;
    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        audio: {
          input: {
            turn_detection: {
              type: "server_vad",
              interrupt_response: true,
              threshold: this.vadThreshold,
            },
          },
        },
      },
    });
  }

  stopPlayback() {
    this.call?.playback.stop();
  }

  setStatus(text: string) {
    this.state.setStatus(text);
  }

  // --- États ------------------------------------------------------------------

  private setState(state: CallState, detail?: string) {
    this.state.setCallState(state, detail);
    this.avatar.setState(state);
    if (this.call) this.call.state = state;
    this.followSearch(state === "thinking", STATUS_TEXT.thinking);
  }

  // Recherche web pendant la réflexion : le statut l'indique (sans phrase parlée)
  private followSearch(active: boolean, defaultText?: string) {
    this.stopSearchWatch?.();
    this.stopSearchWatch = active
      ? watchSearch((searching) =>
          this.state.setStatus(
            searching ? "Je cherche sur internet…" : (defaultText ?? ""),
          ),
        )
      : null;
  }

  private assistantName(): string {
    return currentVoice(this.state)?.name ?? "Antares";
  }

  private voiceSession() {
    const voice = currentVoice(this.state);
    if (!voice) return { instructions: undefined, voice: undefined };
    return {
      instructions: instructionsFor(voice),
      voice: `/voices/${voice.file}`,
    };
  }

  // Voix et consigne de la session : le serveur les fusionne, y compris en cours d'appel
  sendVoiceSession() {
    if (!this.inCall() || !this.call) return;
    this.call.voiceEffect.set(currentVoice(this.state)?.effect);
    const { instructions, voice } = this.voiceSession();
    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        instructions,
        audio: voice ? { output: { voice } } : undefined,
      },
    });
  }

  // --- Lecture ----------------------------------------------------------------

  private maybeBackToListening() {
    const call = this.call;
    if (
      call &&
      call.responseDone &&
      !call.playback.playing &&
      call.state === "speaking"
    ) {
      this.setState("listening");
    }
  }

  // --- Événements serveur -------------------------------------------------------

  private onServerEvent(event: ServerEvent) {
    const call = this.call;
    if (!call) return;
    this.plugins.event(event);
    // Répétition : discours, questions et rapport s'affichent dans son panneau
    const rehearsing = this.plugins.active();
    const itemId = String(event.item_id ?? "");
    switch (event.type) {
      case "input_audio_buffer.speech_started":
        // La réponse à la parole tiendra compte du message écrit en attente
        call.pendingTextResponse = false;
        if (call.playback.playing) {
          call.playback.stop();
          this.state.annotate(call.lastAssistantLine, "interrompu");
        }
        this.setState("user");
        break;
      case "input_audio_buffer.speech_stopped":
        call.speechStoppedAt = performance.now();
        call.speechStoppedEpoch = Date.now();
        this.setState(this.plugins.silent() ? "listening" : "thinking");
        break;
      case "conversation.item.input_audio_transcription.delta":
        if (rehearsing) break;
        this.state.writeLine(itemId, "user", String(event.delta ?? ""), {
          append: true,
        });
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (rehearsing) break;
        this.state.writeLine(itemId, "user", String(event.transcript ?? ""), {
          final: true,
        });
        this.state.remember("user", String(event.transcript ?? ""));
        break;
      case "response.created":
        call.responseDone = false;
        call.firstAudioPending = true;
        break;
      case "response.output_audio.delta":
        if (call.firstAudioPending && call.speechStoppedAt) {
          call.latency = (performance.now() - call.speechStoppedAt) / 1000;
        }
        call.firstAudioPending = false;
        call.playback.enqueue(floatFromBase64Pcm(String(event.delta)));
        this.setState("speaking");
        break;
      case "response.output_audio_transcript.delta":
        if (rehearsing) break;
        this.state.writeLine(itemId, "assistant", String(event.delta ?? ""), {
          append: true,
          who: this.assistantName(),
        });
        call.lastAssistantLine = itemId;
        break;
      case "response.output_audio_transcript.done": {
        if (rehearsing) break;
        const transcript = String(event.transcript ?? "");
        this.state.writeLine(itemId, "assistant", transcript, {
          final: true,
          who: this.assistantName(),
        });
        call.lastAssistantLine = itemId;
        this.state.remember("assistant", transcript);
        if (call.latency)
          this.state.annotate(
            itemId,
            `réponse en ${call.latency.toFixed(1)} s`,
          );
        call.latency = null;
        void this.annotateSources(itemId, call.speechStoppedEpoch - 2000);
        break;
      }
      case "response.done":
        call.responseDone = true;
        if (call.pendingTextResponse) {
          // Message écrit pendant la réponse : le moteur l'a gardé, on demande la suite
          call.pendingTextResponse = false;
          this.requestResponse();
          break;
        }
        if (!call.playback.playing && call.state !== "user")
          this.setState("listening");
        break;
      case "error": {
        const error = event.error as { code?: string } | undefined;
        if (error?.code === "session_limit_reached") {
          this.hangUp(
            "Une conversation est déjà en cours dans un autre onglet",
          );
        } else {
          console.warn("Erreur serveur", event.error);
        }
        break;
      }
      default:
        break;
    }
  }

  // Agent et projets du RAG utilisés pour cette réponse (préparés après la fin de parole)
  async annotateSources(lineId: string, since: number) {
    try {
      const turn = await lastTurn(since);
      if (!turn) return;
      const { annotate, patchLine } = this.state;
      if (turn.agent) annotate(lineId, `agent : ${turn.agent}`);
      if (turn.notice) annotate(lineId, turn.notice);
      if (turn.web?.offline)
        annotate(lineId, "hors ligne : réponse sans recherche web");
      if (turn.projects.length)
        annotate(lineId, `documentation : ${turn.projects.join(", ")}`);
      if (turn.code?.length) {
        // Code demandé à l'oral : retiré de la voix par le routeur, affiché sous la
        // réponse et gardé dans la conversation pour qu'on puisse y revenir
        const fenced = fencedCode(turn.code);
        patchLine(lineId, { code: fenced });
        this.state.appendToLastAssistant(`\n\n${fenced}`);
      }
      if (turn.web?.sources) patchLine(lineId, { web: turn.web });
      if (turn.skipped?.length)
        annotate(lineId, `non lu : ${turn.skipped.join(", ")}`);
      const line = this.state.lines.find((l) => l.id === lineId);
      if (turn.sources.length && line?.rich)
        patchLine(lineId, {
          refs: turn.sources.map((source) => source.replace("/", " · ")),
        });
    } catch (error) {
      console.warn("Agent et sources indisponibles", error);
    }
  }

  // --- Niveau audio de l'avatar ---------------------------------------------------

  private animate = () => {
    const call = this.call;
    if (!call) return;
    const analyser =
      call.state === "speaking" ? call.outputAnalyser : call.micAnalyser;
    const data = call.levelData;
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    const level = Math.min(1, Math.sqrt(sum / data.length) * 6);
    const active = call.state === "speaking" || call.state === "user";
    this.avatar.setLevel(active ? level : 0);
    call.frame = requestAnimationFrame(this.animate);
  };

  // --- Appel ----------------------------------------------------------------------

  toggle() {
    if (this.call) this.hangUp("Appel terminé");
    else void this.start();
  }

  // `replay` : reprise de la conversation en cours ; `onOpen` : appelé une fois connecté
  async start({
    replay = true,
    onOpen,
  }: { replay?: boolean; onOpen?: () => void } = {}) {
    if (this.call || this.starting) return;
    this.starting = true;
    this.setState("connecting");
    // Hors du try : arrêtés si le démarrage échoue après l'ouverture du micro
    let mic: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      await ctx.audioWorklet.addModule("capture-worklet.js");

      const micSource = ctx.createMediaStreamSource(mic);
      const capture = new AudioWorkletNode(ctx, "capture-processor");
      const micAnalyser = ctx.createAnalyser();
      micSource.connect(capture);
      micSource.connect(micAnalyser);

      const outputGain = ctx.createGain();
      const voiceInput = ctx.createGain();
      const outputAnalyser = ctx.createAnalyser();
      const outputStream = ctx.createMediaStreamDestination();
      outputGain.connect(outputAnalyser);
      outputGain.connect(outputStream);
      if (this.speaker) this.speaker.srcObject = outputStream.stream;
      const voiceEffect = createVoiceEffect(ctx, voiceInput, outputGain);
      voiceEffect.set(currentVoice(this.state)?.effect);

      const ws = new WebSocket(realtimeUrl());
      const call: ActiveCall = {
        ctx,
        mic,
        ws,
        capture,
        micAnalyser,
        outputAnalyser,
        voiceEffect,
        playback: new Playback(ctx, voiceInput, voiceEffect, () =>
          this.maybeBackToListening(),
        ),
        state: "connecting",
        responseDone: true,
        pendingTextResponse: false,
        firstAudioPending: false,
        speechStoppedAt: 0,
        speechStoppedEpoch: 0,
        latency: null,
        levelData: new Float32Array(micAnalyser.fftSize),
        frame: 0,
      };
      this.call = call;
      this.starting = false;

      capture.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
        if (ws.readyState !== WebSocket.OPEN || this.micMuted) return;
        if (this.state.halfDuplex && call.state === "speaking") return;
        // Répétition : micro coupé tant que l'avatar parle, et l'écho qui suit
        const avatarHeard =
          call.playback.playing || performance.now() < call.playback.quietUntil;
        if (avatarHeard && this.plugins.holdMic()) return;
        const blocks = this.inputFilter ? this.inputFilter(data) : [data];
        for (const block of blocks)
          ws.send(JSON.stringify(appendAudio(base64FromPcm(block))));
      };

      ws.onopen = () => {
        const { instructions, voice } = this.voiceSession();
        ws.send(
          JSON.stringify(
            sessionUpdate({
              instructions,
              voice,
              vadThreshold: this.vadThreshold,
            }),
          ),
        );
        if (replay) this.replayConversation(ws);
        this.setState("listening");
        this.animate();
        onOpen?.();
      };
      ws.onmessage = ({ data }: MessageEvent<string>) =>
        this.onServerEvent(JSON.parse(data) as ServerEvent);
      ws.onclose = () => {
        if (this.call?.ws === ws) this.hangUp("Appel terminé");
      };
      ws.onerror = () => this.hangUp("Serveur injoignable");
    } catch (error) {
      this.starting = false;
      mic?.getTracks().forEach((track) => track.stop());
      void ctx?.close();
      console.error(error);
      const denied = (error as Error | undefined)?.name === "NotAllowedError";
      this.hangUp(
        denied ? "Accès au micro refusé" : "Impossible de démarrer l'appel",
      );
    }
  }

  hangUp(message: string) {
    this.plugins.callEnded(message);
    const call = this.call;
    if (call) {
      this.call = null;
      cancelAnimationFrame(call.frame);
      // Plus aucun rappel : un socket encore en connexion ne relance pas hangUp
      call.capture.port.onmessage = null;
      call.ws.onopen = null;
      call.ws.onmessage = null;
      call.ws.onerror = null;
      call.ws.onclose = null;
      if (call.ws.readyState <= WebSocket.OPEN) call.ws.close();
      call.mic.getTracks().forEach((track) => track.stop());
      void call.ctx.close();
    }
    if (this.speaker) this.speaker.srcObject = null;
    this.avatar.setLevel(0);
    this.setState("idle", message);
  }

  // Début d'appel : le moteur vocal reprend l'échange écrit là où il en était
  private replayConversation(ws: WebSocket) {
    const stamp = Date.now();
    recentHistory(this.state.messages).forEach((message, index) => {
      ws.send(
        JSON.stringify(
          messageItem(
            `msg_hist${stamp}${index}`,
            message.role,
            message.content,
          ),
        ),
      );
    });
  }

  private requestResponse() {
    const call = this.call;
    if (!call) return;
    call.speechStoppedAt = performance.now();
    call.speechStoppedEpoch = Date.now();
    call.ws.send(JSON.stringify(responseCreate()));
    this.setState("thinking");
  }

  // --- Écrit : pendant l'appel (moteur vocal) ou hors appel (réponse écrite) ------

  // Le texte rejoint la conversation du LLM comme une parole ; `respond` : l'IA y
  // répond (à voix haute en appel), sinon il sert de contexte à la suite de l'échange.
  // Renvoie false si rien n'est parti (texte vide, réponse écrite en cours).
  sendText(raw: string, respond: boolean): boolean {
    const text = raw.trim();
    if (!text || this.state.writing) return false;
    // Le moteur impose le préfixe msg_ aux identifiants de message
    const itemId = `msg_ecrit${Date.now()}`;
    const inCall = this.inCall();
    if (inCall) this.send(messageItem(itemId, "user", text));
    this.state.remember("user", text);
    this.state.writeLine(itemId, "user", text, { final: true });
    this.state.annotate(
      itemId,
      respond ? "écrit" : "écrit · ajouté au contexte",
    );
    if (!respond) return true;
    const call = this.call;
    if (!inCall || !call) void this.writtenReply();
    else if (call.responseDone) this.requestResponse();
    else call.pendingTextResponse = true;
    return true;
  }

  // Réponse écrite hors appel : flux SSE du routeur, affiché au fil de l'eau
  private async writtenReply() {
    const voice = currentVoice(this.state);
    const instructions = voice ? writtenInstructionsFor(voice) : "";
    const since = Date.now();
    const itemId = `msg_rep${since}`;
    const who = this.assistantName();
    let answer = "";
    this.state.setWriting(true);
    // Avatar et statut seulement : l'écran reste « hors appel » (bouton Appeler intact)
    this.avatar.setState("thinking");
    this.state.setStatus("Je vous réponds à l'écrit…");
    this.followSearch(true, "Je vous réponds à l'écrit…");
    try {
      const response = await fetch("api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: instructions },
            ...recentHistory(this.state.messages),
          ],
        }),
      });
      if (!response.ok || !response.body) throw httpError(response.status);
      await readChatStream(response.body.getReader(), (text) => {
        answer = text;
        this.state.writeLine(itemId, "assistant", text, { who });
        this.state.patchLine(itemId, { rich: true });
      });
      this.state.writeLine(itemId, "assistant", answer, { final: true, who });
      this.state.patchLine(itemId, { rich: true });
      this.state.remember("assistant", answer);
      this.state.annotate(
        itemId,
        `écrit · ${((Date.now() - since) / 1000).toFixed(1)} s`,
      );
      void this.annotateSources(itemId, since - 2000);
      this.state.setStatus(STATUS_TEXT.idle);
    } catch (error) {
      console.warn("Réponse écrite impossible", error);
      // Visible dans la conversation, pas seulement dans la ligne d'état
      this.state.writeLine(itemId, "assistant", answer, { final: true, who });
      // Texte partiel gardé tel quel (non mis en forme), comme l'ancienne interface
      this.state.patchLine(itemId, { error: true, rich: false });
      this.state.annotate(
        itemId,
        `réponse impossible : ${failureReason(error)}`,
      );
      if (answer) this.state.remember("assistant", answer);
      this.state.setStatus(STATUS_TEXT.idle);
    } finally {
      this.followSearch(false);
      if (!this.call) this.avatar.setState("idle");
      this.state.setWriting(false);
    }
  }
}
