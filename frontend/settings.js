// Réglages : voix (catalogue voices/voices.json) et modèle LLM (routeur /api).
// Les choix sont persistés côté serveur par le routeur LLM.

// Bref par défaut, mais sans brider les contenus longs demandés explicitement
// (gemma4 coupait un poème après une strophe avec « phrases courtes »).
const BASE_INSTRUCTIONS =
  "Réponds toujours en français, de façon naturelle et sans markdown ni listes. " +
  "En conversation, reste bref. Si l'on te demande un contenu long (poème, histoire, " +
  "explication détaillée), donne-le en entier, sans t'arrêter pour demander s'il faut continuer.";

export const profile = {
  config: {},
  voices: [],
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

export function instructionsFor(voice) {
  const role =
    voice.gender === "M"
      ? "un assistant vocal bienveillant"
      : "une assistante vocale bienveillante";
  return `Tu es ${voice.name}, ${role}. ${BASE_INSTRUCTIONS}`;
}

async function getJson(url, options) {
  const response = await fetch(url, { cache: "no-store", ...options });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.detail ?? `${url} : HTTP ${response.status}`);
  }
  return response.json();
}

export async function loadProfile() {
  const [config, catalog, settings] = await Promise.all([
    getJson("config.json"),
    getJson("voices/voices.json"),
    getJson("api/settings"),
  ]);
  Object.assign(profile, { config, voices: catalog.voices, settings });
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

export function initSettingsDialog({ onApplied }) {
  const dialog = document.getElementById("settings");
  const form = document.getElementById("settings-form");
  const voiceOptions = document.getElementById("voice-options");
  const modelOptions = document.getElementById("model-options");
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
          preview.src = voicePath(voice);
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

  document
    .getElementById("open-settings")
    .addEventListener("click", async () => {
      error.textContent = "";
      renderVoices();
      dialog.showModal();
      try {
        await renderModels();
      } catch (err) {
        modelOptions.textContent = "";
        error.textContent = `Liste des modèles indisponible : ${err.message}`;
      }
    });

  document.getElementById("cancel-settings").addEventListener("click", () => {
    preview.pause();
    dialog.close();
  });

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
        }),
      });
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
