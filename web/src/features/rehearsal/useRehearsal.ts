import { useStore } from "zustand";

import { rehearsal } from "./instance";

// Séance en cours (objet mutable), relue à chaque changement signalé par le contrôleur
export function useRehearsal() {
  useStore(rehearsal.view, (state) => state.version);
  return rehearsal.session;
}
