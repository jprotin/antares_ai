// Base de la page, lue au montage de chaque sous-page (l'ordre de la visite est gardé)
import { useEffect } from "react";
import { useStore } from "zustand";

import { loadPresidentielle, presidentielleStore } from "./state";

export function usePresidentielle() {
  useEffect(() => {
    void loadPresidentielle();
  }, []);
  return useStore(presidentielleStore);
}
