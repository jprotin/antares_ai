// Démarrage (une fois, hors React) : profil du moteur, voix alignée sur l'avatar,
// teinte de l'agent, documents joints, suivi du réseau.
import { BASE_HUE, setDomainHue } from "@/engines/theme/theme";
import { startNetMonitor } from "@/engines/net/netMonitor";
import { getJson, sendJson } from "@/lib/api";
import type { Agent, Config, Mode, Settings, Voice } from "@/types/api";
import { store } from "@/state/store";

import { loadDocuments } from "@/features/attachments";

import { features } from "./features";
import type { FeatureDef } from "./types";
import { avatar, engine } from "./runtime";

export async function loadProfile() {
  const [config, catalog, settings, agents, modes] = await Promise.all([
    getJson<Config>("config.json"),
    getJson<{ voices: Voice[] }>("voices/voices.json"),
    getJson<Settings>("api/settings"),
    getJson<Agent[]>("api/agents").catch(() => []),
    getJson<Mode[]>("api/modes").catch(() => []),
  ]);
  store.getState().setProfile({
    config,
    voices: catalog.voices,
    settings,
    agents,
    modes,
  });
}

// Enregistre un réglage (agent, mode, voix…) choisi hors de la fenêtre Réglages
export async function saveSetting(update: Settings) {
  const settings = await sendJson<Settings>("api/settings", "PUT", update);
  store.getState().setProfile({ settings });
  return settings;
}

// Voix d'un avatar (champ `avatars` du catalogue) ; seul l'orbe en propose plusieurs
export function voicesFor(kind: string): Voice[] {
  return store
    .getState()
    .voices.filter((voice) => voice.avatars?.includes(kind));
}

// La voix suit l'avatar (mémorisé dans ce navigateur) : réalignement au chargement
async function alignVoiceWithAvatar() {
  const voices = voicesFor(avatar.kind);
  const current = store.getState().settings?.voice;
  const first = voices[0];
  if (!first || voices.some((v) => v.id === current)) return;
  try {
    await saveSetting({ voice: first.id });
  } catch (error) {
    console.warn("Voix de l'avatar non appliquée", error);
  }
}

export function applyAgentHue() {
  const { agents, settings } = store.getState();
  const active = agents.find((agent) => agent.id === settings?.agent);
  avatar.setHue(setDomainHue(active?.domain) - BASE_HUE);
}

// Branche sur l'appel les plugins déclarés par les fonctionnalités
export function registerCallPlugins(
  list: FeatureDef[],
  target: Parameters<NonNullable<FeatureDef["callPlugin"]>>[0],
) {
  return list.flatMap((feature) =>
    feature.callPlugin
      ? [target.plugins.register(feature.callPlugin(target))]
      : [],
  );
}

export function bootstrap() {
  registerCallPlugins(features, engine);
  const state = store.getState();
  loadDocuments().catch((error) =>
    console.warn("Documents joints indisponibles", error),
  );
  startNetMonitor({
    onState: state.setNet,
    onChange: (online) =>
      store
        .getState()
        .systemLine(
          online
            ? "Connexion Internet rétablie : recherche web et modèles Claude disponibles."
            : "Connexion Internet perdue : pas de recherche web, modèles locaux seulement.",
          !online,
        ),
    onSharing: (sharing) =>
      store
        .getState()
        .systemLine(
          sharing
            ? "Partage ngrok ouvert : Claude et l'écriture dans le RAG sont désactivés."
            : "Partage ngrok fermé.",
        ),
  });
  loadProfile()
    .then(async () => {
      await alignVoiceWithAvatar();
      applyAgentHue();
    })
    .catch((error) => {
      console.warn("Profil du moteur indisponible", error);
      store.getState().setCallState("idle", "Réglages indisponibles");
    });
}
