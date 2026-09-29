// Écran d'appel : micro -> serveur Realtime (WebSocket) -> voix + sous-titres.
// Protocole : sous-ensemble OpenAI Realtime implémenté par huggingface/speech-to-speech.

import { initAgentsDialog } from "./agents.js";
import { Orb } from "./orb.js";
import { createPicker } from "./picker.js";
import {
  currentVoice,
  getJson,
  initSettingsDialog,
  instructionsFor,
  loadProfile,
  modelLabel,
  profile,
  projectLabel,
  saveSetting,
  voicePath,
} from "./settings.js";
import { hueFor, initTheme } from "./theme.js";

const SAMPLE_RATE = 24000;
const REALTIME_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/v1/realtime`;

const STATUS_TEXT = {
  idle: "Disponible pour un appel",
  connecting: "Connexion…",
  listening: "Je vous écoute",
  user: "Vous parlez…",
  thinking: "Je réfléchis…",
  speaking: "Je vous réponds",
};

const ui = {
  root: document.querySelector(".app"),
  status: document.getElementById("status"),
  name: document.getElementById("assistant-name"),
  info: document.getElementById("model-info"),
  subtitles: document.getElementById("subtitles"),
  empty: document.getElementById("empty"),
  button: document.getElementById("call"),
  halfDuplex: document.getElementById("half-duplex"),
  speaker: document.getElementById("speaker"),
  composer: document.getElementById("composer"),
  composerText: document.getElementById("composer-text"),
  composerContext: document.getElementById("composer-context"),
  composerSend: document.getElementById("composer-send"),
};

const orb = new Orb(document.getElementById("orb"));
const theme = initTheme({
  button: document.getElementById("theme-toggle"),
  orb,
});
let call = null;

function setState(state, detail) {
  ui.root.dataset.state = state;
  ui.status.textContent = detail ?? STATUS_TEXT[state];
  orb.setState(state);
  if (call) call.state = state;
}

function base64FromPcm(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function floatFromBase64Pcm(b64) {
  const binary = atob(b64);
  const samples = new Float32Array(binary.length / 2);
  for (let i = 0; i < samples.length; i += 1) {
    const value =
      binary.charCodeAt(2 * i) | (binary.charCodeAt(2 * i + 1) << 8);
    samples[i] = (value >= 0x8000 ? value - 0x10000 : value) / 0x8000;
  }
  return samples;
}

// Voix et consigne de la session : le serveur les fusionne dans sa configuration,
// y compris en cours d'appel (effet dès la phrase suivante).
function voiceSession() {
  const voice = currentVoice();
  if (!voice) return {};
  return {
    instructions: instructionsFor(voice),
    audio: { output: { voice: voicePath(voice) } },
  };
}

// --- Sous-titres ---------------------------------------------------------------

function subtitleLine(itemId, role) {
  let line = ui.subtitles.querySelector(`[data-item="${CSS.escape(itemId)}"]`);
  if (!line) {
    ui.empty?.remove();
    line = document.createElement("p");
    line.className = `line line--${role} line--partial`;
    line.dataset.item = itemId;
    const who = document.createElement("span");
    who.className = "line__who";
    who.textContent =
      role === "user" ? "Vous" : (currentVoice()?.name ?? "Antares");
    const text = document.createElement("span");
    text.className = "line__text";
    line.append(who, text);
    ui.subtitles.append(line);
  }
  return line;
}

function writeSubtitle(
  itemId,
  role,
  text,
  { append = false, final = false } = {},
) {
  const line = subtitleLine(itemId, role);
  const span = line.querySelector(".line__text");
  span.textContent = append ? span.textContent + text : text;
  line.classList.toggle("line--partial", !final);
  ui.subtitles.scrollTop = ui.subtitles.scrollHeight;
  return line;
}

function annotate(line, text) {
  if (!line) return;
  const existing = line.querySelector(".line__meta");
  if (existing) {
    existing.textContent += ` · ${text}`;
    return;
  }
  const meta = document.createElement("span");
  meta.className = "line__meta";
  meta.textContent = text;
  line.append(meta);
}

// Agent et projets du RAG utilisés pour cette réponse (préparés après la fin de parole)
async function annotateSources(line, since) {
  try {
    const response = await fetch("api/turn/last", { cache: "no-store" });
    const turn = await response.json();
    if (turn.at * 1000 < since) return;
    if (turn.agent) annotate(line, `agent : ${turn.agent}`);
    if (turn.projects.length) {
      annotate(line, `documentation : ${turn.projects.join(", ")}`);
    }
  } catch (error) {
    console.warn("Agent et sources indisponibles", error);
  }
}

// --- Lecture de la réponse -----------------------------------------------------

function enqueuePlayback(samples) {
  const { ctx } = call;
  const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
  buffer.copyToChannel(samples, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(call.outputGain);
  const startAt = Math.max(ctx.currentTime + 0.03, call.playhead);
  source.start(startAt);
  call.playhead = startAt + buffer.duration;
  call.sources.add(source);
  source.onended = () => {
    call?.sources.delete(source);
    maybeBackToListening();
  };
}

function stopPlayback() {
  for (const source of call.sources) {
    source.onended = null;
    source.stop();
  }
  call.sources.clear();
  call.playhead = 0;
}

function maybeBackToListening() {
  if (
    call &&
    call.responseDone &&
    call.sources.size === 0 &&
    call.state === "speaking"
  ) {
    setState("listening");
  }
}

// --- Événements serveur --------------------------------------------------------

function onServerEvent(event) {
  switch (event.type) {
    case "input_audio_buffer.speech_started":
      // La réponse à la parole tiendra compte du message écrit en attente
      call.pendingTextResponse = false;
      if (call.sources.size) {
        stopPlayback();
        annotate(call.lastAssistantLine, "interrompu");
      }
      setState("user");
      break;
    case "input_audio_buffer.speech_stopped":
      call.speechStoppedAt = performance.now();
      call.speechStoppedEpoch = Date.now();
      setState("thinking");
      break;
    case "conversation.item.input_audio_transcription.delta":
      writeSubtitle(event.item_id, "user", event.delta, { append: true });
      break;
    case "conversation.item.input_audio_transcription.completed":
      writeSubtitle(event.item_id, "user", event.transcript, { final: true });
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
      enqueuePlayback(floatFromBase64Pcm(event.delta));
      setState("speaking");
      break;
    case "response.output_audio_transcript.delta":
      call.lastAssistantLine = writeSubtitle(
        event.item_id,
        "assistant",
        event.delta,
        { append: true },
      );
      break;
    case "response.output_audio_transcript.done":
      call.lastAssistantLine = writeSubtitle(
        event.item_id,
        "assistant",
        event.transcript,
        { final: true },
      );
      if (call.latency)
        annotate(
          call.lastAssistantLine,
          `réponse en ${call.latency.toFixed(1)} s`,
        );
      call.latency = null;
      annotateSources(call.lastAssistantLine, call.speechStoppedEpoch - 2000);
      break;
    case "response.done":
      call.responseDone = true;
      if (call.pendingTextResponse) {
        // Message écrit pendant la réponse : le moteur l'a gardé, on demande la suite
        call.pendingTextResponse = false;
        requestResponse();
        break;
      }
      if (call.sources.size === 0 && call.state !== "user")
        setState("listening");
      break;
    case "error":
      if (event.error?.code === "session_limit_reached") {
        hangUp("Une conversation est déjà en cours dans un autre onglet");
      } else {
        console.warn("Erreur serveur", event.error);
      }
      break;
    default:
      break;
  }
}

// --- Niveau audio de l'orbe ----------------------------------------------------

function animateOrb() {
  if (!call) return;
  const analyser =
    call.state === "speaking" ? call.outputAnalyser : call.micAnalyser;
  const data = call.levelData;
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (const v of data) sum += v * v;
  const level = Math.min(1, Math.sqrt(sum / data.length) * 6);
  const active = call.state === "speaking" || call.state === "user";
  orb.setLevel(active ? level : 0);
  call.frame = requestAnimationFrame(animateOrb);
}

// --- Appel ---------------------------------------------------------------------

async function startCall() {
  ui.button.disabled = true;
  setState("connecting");
  try {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    await ctx.audioWorklet.addModule("capture-worklet.js");

    const micSource = ctx.createMediaStreamSource(mic);
    const capture = new AudioWorkletNode(ctx, "capture-processor");
    const micAnalyser = ctx.createAnalyser();
    micSource.connect(capture);
    micSource.connect(micAnalyser);

    // Sortie via un <audio> (et non ctx.destination) : le navigateur l'utilise
    // comme référence d'annulation d'écho, ce qui permet de lui couper la parole.
    const outputGain = ctx.createGain();
    const outputAnalyser = ctx.createAnalyser();
    const outputStream = ctx.createMediaStreamDestination();
    outputGain.connect(outputAnalyser);
    outputGain.connect(outputStream);
    ui.speaker.srcObject = outputStream.stream;

    const ws = new WebSocket(REALTIME_URL);
    call = {
      ctx,
      mic,
      ws,
      capture,
      micAnalyser,
      outputGain,
      outputAnalyser,
      sources: new Set(),
      playhead: 0,
      state: "connecting",
      responseDone: true,
      levelData: new Float32Array(micAnalyser.fftSize),
    };

    capture.port.onmessage = ({ data }) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ui.halfDuplex.checked && call.state === "speaking") return;
      ws.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: base64FromPcm(data),
        }),
      );
    };

    ws.onopen = () => {
      const { instructions, audio } = voiceSession();
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: {
            type: "realtime",
            instructions,
            audio: {
              input: {
                format: { type: "audio/pcm", rate: SAMPLE_RATE },
                turn_detection: {
                  type: "server_vad",
                  interrupt_response: true,
                },
              },
              output: {
                format: { type: "audio/pcm", rate: SAMPLE_RATE },
                ...audio?.output,
              },
            },
          },
        }),
      );
      setState("listening");
      setComposerEnabled(true);
      ui.button.textContent = "Raccrocher";
      ui.button.disabled = false;
      animateOrb();
    };
    ws.onmessage = ({ data }) => onServerEvent(JSON.parse(data));
    ws.onclose = () => {
      if (call?.ws === ws) hangUp("Appel terminé");
    };
    ws.onerror = () => hangUp("Serveur injoignable");
  } catch (error) {
    console.error(error);
    const denied = error?.name === "NotAllowedError";
    hangUp(denied ? "Accès au micro refusé" : "Impossible de démarrer l'appel");
  }
}

function hangUp(message) {
  if (call) {
    const { ws, mic, ctx, frame } = call;
    call = null;
    cancelAnimationFrame(frame);
    ws.onclose = null;
    if (ws.readyState <= WebSocket.OPEN) ws.close();
    mic.getTracks().forEach((track) => track.stop());
    ctx.close();
  }
  ui.speaker.srcObject = null;
  setComposerEnabled(false);
  orb.setLevel(0);
  ui.button.textContent = "Appeler";
  ui.button.disabled = false;
  setState("idle", message);
}

ui.button.addEventListener("click", () =>
  call ? hangUp("Appel terminé") : startCall(),
);

// --- Saisie écrite pendant l'appel ------------------------------------------------

function setComposerEnabled(enabled) {
  for (const element of [
    ui.composerText,
    ui.composerContext,
    ui.composerSend,
  ]) {
    element.disabled = !enabled;
  }
}

function requestResponse() {
  call.speechStoppedAt = performance.now();
  call.speechStoppedEpoch = Date.now();
  call.ws.send(JSON.stringify({ type: "response.create" }));
  setState("thinking");
}

// Le texte rejoint la conversation du LLM comme une parole ; `respond` : l'IA y répond
// à voix haute, sinon il sert de contexte à la suite de l'échange.
function sendText(respond) {
  const text = ui.composerText.value.trim();
  if (!text || call?.ws.readyState !== WebSocket.OPEN) return;
  // Le moteur impose le préfixe msg_ aux identifiants de message
  const itemId = `msg_ecrit${Date.now()}`;
  call.ws.send(
    JSON.stringify({
      type: "conversation.item.create",
      item: {
        id: itemId,
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    }),
  );
  const line = writeSubtitle(itemId, "user", text, { final: true });
  annotate(line, respond ? "écrit" : "écrit · ajouté au contexte");
  ui.composerText.value = "";
  if (!respond) return;
  if (call.responseDone) {
    requestResponse();
  } else {
    call.pendingTextResponse = true;
  }
}

ui.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  sendText(true);
});
ui.composerContext.addEventListener("click", () => sendText(false));
ui.composerText.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendText(true);
  }
});

function renderProfile() {
  const voice = currentVoice();
  const { config, settings } = profile;
  const name = voice?.name ?? "Antares";
  ui.name.textContent = name;
  document.title = `${name} · Antares`;
  const quantization = config.ttsQuantization
    ? `, ${config.ttsQuantization}`
    : "";
  ui.info.replaceChildren();
  for (const [label, value] of [
    ["LLM", modelLabel(settings?.model)],
    ["Projet", projectLabel(settings?.project)],
    ["Voix", `${name} (${config.tts} clonée${quantization})`],
    ["Transcription", config.stt],
  ]) {
    const row = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = `${label} `;
    row.append(strong, value);
    ui.info.append(row);
  }
}

function sendVoiceSession() {
  if (call?.ws.readyState !== WebSocket.OPEN) return;
  call.ws.send(
    JSON.stringify({
      type: "session.update",
      session: { type: "realtime", ...voiceSession() },
    }),
  );
}

// --- Agent et mode (haut de l'écran d'appel) ------------------------------------

const MAX_SUGGESTED = 5;

async function choose(update) {
  try {
    await saveSetting(update);
    renderPickers();
  } catch (error) {
    setState(call ? call.state : "idle", `Réglage refusé : ${error.message}`);
  }
}

const agentPicker = createPicker({
  root: document.getElementById("agent-picker"),
  label: "Agent",
  searchable: true,
  onSelect: (agent) => choose({ agent }),
});

const modePicker = createPicker({
  root: document.getElementById("mode-picker"),
  label: "Mode",
  onSelect: (mode) => choose({ mode }),
});

function renderPickers() {
  const { agents, modes, settings } = profile;
  const mode = modes.find((m) => m.id === settings?.mode) ?? modes[0];
  const item = (agent) => ({
    value: agent.id,
    label: agent.name,
    detail: agent.description || agent.usage,
    hue: hueFor(agent.domain),
  });
  // En tête : les agents dont l'utilité correspond au mode
  const suggested = agents
    .filter((agent) => mode?.usages.includes(agent.usage))
    .slice(0, MAX_SUGGESTED);
  const domains = [...new Set(agents.map((agent) => agent.domain))].sort(
    (a, b) => a.localeCompare(b),
  );
  agentPicker.update(
    [
      {
        items: [
          {
            value: "",
            label: "Aucun",
            detail: "Sauf agent cité par son nom",
            hue: hueFor(null),
          },
        ],
      },
      ...(suggested.length
        ? [{ label: `Suggérés · ${mode.name}`, items: suggested.map(item) }]
        : []),
      ...domains.map((domain) => ({
        label: domain,
        items: agents
          .filter((agent) => agent.domain === domain)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(item),
      })),
    ],
    settings?.agent ?? "",
  );
  modePicker.update(
    [
      {
        items: modes.map((m) => ({
          value: m.id,
          label: m.name,
          detail: m.description,
        })),
      },
    ],
    mode?.id ?? "",
  );
  const active = agents.find((agent) => agent.id === settings?.agent);
  theme.setDomain(active?.domain);
}

initSettingsDialog({
  onApplied: () => {
    renderProfile();
    sendVoiceSession();
  },
});

initAgentsDialog({
  onChanged: async () => {
    profile.agents = await getJson("api/agents");
    renderPickers();
  },
});

loadProfile()
  .then(() => {
    renderProfile();
    renderPickers();
  })
  .catch((error) => {
    console.warn("Profil du moteur indisponible", error);
    setState("idle", "Réglages indisponibles");
  });
