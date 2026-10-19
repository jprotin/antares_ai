import { useStore } from "zustand";

import { store, type AppState } from "./store";

export function useAppStore<T>(selector: (state: AppState) => T): T {
  return useStore(store, selector);
}
