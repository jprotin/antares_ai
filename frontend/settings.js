// Réglages : voix (catalogue voices/voices.json), modèle LLM et projet RAG (routeur /api).
// L'agent et le mode se choisissent sur l'écran d'appel (cf. app.js).
// Les choix sont persistés côté serveur par le routeur LLM.

// Bref par défaut, mais sans brider les contenus longs demandés explicitement
// (gemma4 coupait un poème après une strophe avec « phrases courtes »).
// La règle du code vient en premier : placée après « sans markdown », le modèle
// l'ignorait pour les requêtes courtes (SQL : 0/3 ; en premier : 12/12, cf. voicecode.py).
const BASE_INSTRUCTIONS =
  "Règle prioritaire : dès que ta réponse contient du code, même une seule ligne " +
  "(script, commande, requête SQL, fichier de configuration, Dockerfile), écris ce code " +
  "entre trois accents graves avec le langage (```sql, puis le code, puis ```). Ce bloc " +
  "s'affiche à l'écran et n'est jamais lu. Autour, en phrases parlées, annonce que tu " +
  "l'affiches à l'écran puis explique ce qu'il fait étape par étape, sans lire le code " +
  "ni parler de Markdown. " +
  "Pour tout le reste, réponds toujours en français, de façon naturelle et sans markdown " +
  "ni listes. En conversation, reste bref. Si l'on te demande un contenu long (poème, " +
  "histoire, explication détaillée), donne-le en entier, sans t'arrêter pour demander " +
  "s'il faut continuer.";

export const profile = {
  config: {},
  voices: [],
  agents: [],
  modes: [],
  settings: null,
};

export function currentVoice() {
  return (
    profile.voices.find((voice) => voice.id === profile.settings?.voice) ??
    profile.voices[0]
  );
}

export function voicePath(voice) {
  return `/voices/${voice.file}`;
}

// Extrait à écouter : avec l'effet de lecture de la voix, s'il y en a un
export function previewPath(voice) {
  return `/voices/${voice.preview ?? voice.file}`;
}

// À l'écrit, la mise en forme est rendue (render.js) : Markdown encouragé
const WRITTEN_INSTRUCTIONS =
  "Réponds toujours en français. L'échange se fait à l'écrit : structure tes réponses " +
  "en Markdown quand c'est utile (titres courts, listes, tableaux, citations avec >, " +
  "blocs de code avec le langage indiqué et une indentation soignée). Reste concis pour " +
  "une question simple. Ne cite un lien Internet que pour une page de documentation " +
  "officielle dont tu es certain de l'adresse ; n'invente jamais d'URL.";

export function writtenInstructionsFor(voice) {
  const role =
    voice.gender === "M"
      ? "un assistant bienveillant"
      : "une assistante bienveillante";
  return `Tu es ${voice.name}, ${role}. ${WRITTEN_INSTRUCTIONS}`;
}

export function instructionsFor(voice) {
  const role =
    voice.gender === "M"
      ? "un assistant vocal bienveillant"
      : "une assistante vocale bienveillante";
  return `Tu es ${voice.name}, ${role}. ${BASE_INSTRUCTIONS}`;
}

export async function getJson(url, options) {
  const response = await fetch(url, { cache: "no-store", ...options });
  if (!response.ok) {
    const { detail } = await response.json().catch(() => ({}));
    // Erreurs de validation : liste de champs refusés
    const message = Array.isArray(detail)
      ? detail.map((d) => `${d.loc?.at(-1)} : ${d.msg}`).join(" ; ")
      : detail;
    throw new Error(message ?? `${url} : HTTP ${response.status}`);
  }
  return response.json();
}

export async function loadProfile() {
  const [config, catalog, settings, agents, modes] = await Promise.all([
    getJson("config.json"),
    getJson("voices/voices.json"),
    getJson("api/settings"),
    getJson("api/agents").catch(() => []),
    getJson("api/modes").catch(() => []),
  ]);
  Object.assign(profile, {
    config,
    voices: catalog.voices,
    settings,
    agents,
    modes,
  });
  return profile;
}

// Vitesse mesurée par le routeur sur les vraies conversations. À l'oral, ~4 tokens/s
// suffisent pour suivre la parole : au-delà de 15, la réponse ne prend pas de retard.
function modelBadge(model) {
  const observed = model.observed;
  if (model.provider === "claude") {
    const delay = observed
      ? ` · ~${Math.round(observed.ttft)} s par réponse`
      : "";
    return ["badge--cloud", `hors local${delay}`];
  }
  if (!observed) {
    return ["badge--unknown", "pas encore utilisé"];
  }
  const speed = `${Math.round(observed.speed)} tok/s · 1er mot ${observed.ttft.toFixed(1).replace(".", ",")} s`;
  return [observed.speed >= 15 ? "badge--gpu" : "badge--slow", speed];
}

function modelDetail(model) {
  if (model.provider === "claude") {
    return "Claude Code (abonnement) · la conversation écrite est envoyée à Anthropic";
  }
  return `${model.parameterSize ?? "?"} paramètres · ${model.sizeGb} Go`;
}

export function modelLabel(name) {
  if (name?.startsWith("claude:")) {
    const model = name.slice("claude:".length);
    return `Claude ${model.charAt(0).toUpperCase()}${model.slice(1)} (hors local)`;
  }
  return name ?? "?";
}

export function agentLabel(agentId) {
  return (
    profile.agents.find((agent) => agent.id === agentId)?.name ??
    "aucun (agent cité par son nom)"
  );
}

export function projectLabel(project) {
  return project || "aucun (projet cité par son nom)";
}

function optionRow({ name, value, checked, title, detail, trailing }) {
  const label = document.createElement("label");
  label.className = "option";
  const input = document.createElement("input");
  Object.assign(input, { type: "radio", name, value, checked });
  const text = document.createElement("span");
  const strong = document.createElement("span");
  strong.className = "option__title";
  strong.textContent = title;
  const small = document.createElement("span");
  small.className = "option__detail";
  small.textContent = detail;
  text.append(strong, small);
  label.append(input, text, trailing);
  return label;
}

export function initSettingsDialog({ avatar, onApplied }) {
  const dialog = document.getElementById("settings");
  const form = document.getElementById("settings-form");
  const voiceOptions = document.getElementById("voice-options");
  const modelOptions = document.getElementById("model-options");
  const projectOptions = document.getElementById("project-options");
  const error = document.getElementById("settings-error");
  const apply = document.getElementById("apply-settings");
  const preview = document.getElementById("preview");

  function renderVoices() {
    voiceOptions.replaceChildren(
      ...profile.voices.map((voice) => {
        const listen = document.createElement("button");
        listen.type = "button";
        listen.className = "preview-button";
        listen.textContent = "Écouter";
        listen.addEventListener("click", (event) => {
          event.preventDefault();
          preview.src = previewPath(voice);
          preview.play();
        });
        return optionRow({
          name: "voice",
          value: voice.id,
          checked: voice.id === profile.settings.voice,
          title: voice.name,
          detail: `${voice.gender === "M" ? "Voix masculine" : "Voix féminine"} · ${voice.source}`,
          trailing: listen,
        });
      }),
    );
  }

  async function renderModels() {
    modelOptions.textContent = "Chargement de la liste…";
    const models = await getJson("api/models");
    modelOptions.replaceChildren(
      ...models.map((model) => {
        const [variant, text] = modelBadge(model);
        const badge = document.createElement("span");
        badge.className = `badge ${variant}`;
        badge.textContent = text;
        return optionRow({
          name: "model",
          value: model.name,
          checked: model.name === profile.settings.model,
          title: model.label ?? model.name,
          detail: modelDetail(model),
          trailing: badge,
        });
      }),
    );
  }

  async function renderProjects() {
    projectOptions.textContent = "Chargement de la liste…";
    const projects = await getJson("api/projects");
    const none = {
      id: "",
      title: "Aucun",
      detail: "Sauf projet cité par son nom",
    };
    projectOptions.replaceChildren(
      ...[none, ...projects].map((project) =>
        optionRow({
          name: "project",
          value: project.id,
          checked: project.id === (profile.settings.project ?? ""),
          title: project.title ?? project.id,
          detail: project.detail ?? `${project.chunks} extraits indexés`,
          trailing: document.createElement("span"),
        }),
      ),
    );
  }

  // Avatar associé à une voix (Bender) : sa voix est cochée avec lui, modifiable
  form.addEventListener("change", (event) => {
    if (event.target.name !== "avatar") return;
    const voice = profile.voices.find((v) => v.avatar === event.target.value);
    const input =
      voice && form.querySelector(`input[name="voice"][value="${voice.id}"]`);
    if (input) input.checked = true;
  });

  document
    .getElementById("open-settings")
    .addEventListener("click", async () => {
      error.textContent = "";
      renderVoices();
      for (const input of form.querySelectorAll('input[name="avatar"]')) {
        input.checked = input.value === avatar.kind;
      }
      dialog.showModal();
      const [models, projects] = await Promise.allSettled([
        renderModels(),
        renderProjects(),
      ]);
      if (models.status === "rejected") {
        modelOptions.textContent = "";
        error.textContent = `Liste des modèles indisponible : ${models.reason.message}`;
      }
      if (projects.status === "rejected") {
        projectOptions.textContent = "RAG indisponible";
      }
    });

  function close() {
    preview.pause();
    dialog.close();
  }
  document.getElementById("cancel-settings").addEventListener("click", close);
  closeOnBackdrop(dialog, close);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    apply.disabled = true;
    error.textContent = "";
    try {
      profile.settings = await getJson("api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voice: data.get("voice"),
          model: data.get("model"),
          project: data.get("project") ?? undefined,
        }),
      });
      const kind = data.get("avatar");
      if (kind && kind !== avatar.kind) avatar.use(kind);
      preview.pause();
      dialog.close();
      onApplied(profile);
    } catch (err) {
      error.textContent = err.message;
    } finally {
      apply.disabled = false;
    }
  });
}

// Enregistre un réglage (agent, mode…) choisi hors de la fenêtre Réglages
export async function saveSetting(update) {
  profile.settings = await getJson("api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  return profile.settings;
}

// Fenêtres : fermeture au clic sur le fond (hors du contenu)
// (le clic doit commencer et finir sur le fond : une sélection de texte qui déborde
// de la fenêtre ne la ferme pas).
export function closeOnBackdrop(dialog, onClose = () => dialog.close()) {
  let downOnBackdrop = false;
  dialog.addEventListener("pointerdown", (event) => {
    downOnBackdrop = event.target === dialog;
  });
  dialog.addEventListener("click", (event) => {
    if (downOnBackdrop && event.target === dialog) onClose();
  });
}
