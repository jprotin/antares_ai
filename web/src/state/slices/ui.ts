// Fenêtre ouverte (une à la fois, comme les <dialog> de l'ancienne interface)
import type { StateCreator } from "zustand/vanilla";

export type UiSlice = {
  openDialog: string | null;
  showDialog(id: string): void;
  closeDialog(): void;
};

export const createUiSlice: StateCreator<UiSlice> = (set) => ({
  openDialog: null,
  showDialog: (id) => set({ openDialog: id }),
  closeDialog: () => set({ openDialog: null }),
});
