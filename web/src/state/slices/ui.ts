// État d'interface : fenêtre ouverte (une à la fois, comme les <dialog> de l'ancienne
// interface), réseau, écriture en cours, demi-duplex
import type { StateCreator } from "zustand/vanilla";

import type { NetState } from "@/types/api";

export type UiSlice = {
  openDialog: string | null;
  showDialog(id: string): void;
  closeDialog(): void;
  net: NetState | null;
  setNet(net: NetState): void;
  // Réponse écrite en cours (saisie désactivée)
  writing: boolean;
  setWriting(writing: boolean): void;
  // Demi-duplex : micro coupé pendant la réponse
  halfDuplex: boolean;
  setHalfDuplex(halfDuplex: boolean): void;
  // Attributs data-* de la racine, écrits par une fonctionnalité (data-rehearsal…)
  rootData: Record<string, string>;
  setRootData(key: string, value: string | null): void;
};

// Une fenêtre est ouverte (raccourcis de la visionneuse inactifs, RE-2)
export const isAnyDialogOpen = (state: UiSlice) => state.openDialog !== null;

export const createUiSlice: StateCreator<UiSlice> = (set) => ({
  openDialog: null,
  showDialog: (id) => set({ openDialog: id }),
  closeDialog: () => set({ openDialog: null }),
  net: null,
  setNet: (net) => set({ net }),
  writing: false,
  setWriting: (writing) => set({ writing }),
  halfDuplex: false,
  setHalfDuplex: (halfDuplex) => set({ halfDuplex }),
  rootData: {},
  setRootData: (key, value) =>
    set((state) => {
      const rootData = { ...state.rootData };
      if (value === null) delete rootData[key];
      else rootData[key] = value;
      return { rootData };
    }),
});
