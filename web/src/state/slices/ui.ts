// État d'interface : pile des fenêtres ouvertes (une fenêtre ouverte depuis Réglages
// s'empile dessus, comme les <dialog> de l'ancienne interface), réseau, écriture en cours,
// demi-duplex, version des catalogues (modèles, projets, agents)
import type { StateCreator } from "zustand/vanilla";

import type { NetState } from "@/types/api";

export type UiSlice = {
  dialogs: string[];
  // Fenêtre du dessus, ou null
  openDialog: string | null;
  showDialog(id: string): void;
  // Ferme la fenêtre donnée (par défaut celle du dessus)
  closeDialog(id?: string): void;
  // Incrémentée quand une fenêtre change fournisseurs, projets ou agents : les listes
  // affichées ailleurs (Réglages) se rechargent ; les agents passent par setProfile
  catalogVersion: number;
  catalogChanged(): void;
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
export const isAnyDialogOpen = (state: UiSlice) => state.dialogs.length > 0;

export const createUiSlice: StateCreator<UiSlice> = (set) => ({
  dialogs: [],
  openDialog: null,
  showDialog: (id) =>
    set((state) => {
      const dialogs = [...state.dialogs.filter((d) => d !== id), id];
      return { dialogs, openDialog: id };
    }),
  closeDialog: (id) =>
    set((state) => {
      const target = id ?? state.dialogs.at(-1);
      const dialogs = state.dialogs.filter((d) => d !== target);
      return { dialogs, openDialog: dialogs.at(-1) ?? null };
    }),
  catalogVersion: 0,
  catalogChanged: () =>
    set((state) => ({ catalogVersion: state.catalogVersion + 1 })),
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
