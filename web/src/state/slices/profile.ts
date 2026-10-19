// Profil chargé au démarrage : configuration, catalogue des voix, réglages, agents, modes
import type { StateCreator } from "zustand/vanilla";

import type { Agent, Config, Mode, Settings, Voice } from "@/types/api";

export type ProfileSlice = {
  config: Config;
  voices: Voice[];
  agents: Agent[];
  modes: Mode[];
  settings: Settings | null;
  setProfile(profile: Partial<Omit<ProfileSlice, "setProfile">>): void;
};

export const createProfileSlice: StateCreator<ProfileSlice> = (set) => ({
  config: {},
  voices: [],
  agents: [],
  modes: [],
  settings: null,
  setProfile: (profile) => set(profile),
});

// Voix choisie dans les réglages, la première du catalogue sinon
export function currentVoice(state: ProfileSlice): Voice | undefined {
  return (
    state.voices.find((voice) => voice.id === state.settings?.voice) ??
    state.voices[0]
  );
}
