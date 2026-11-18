// Relevé périodique du dernier passage, après le premier relevé du réseau (pastille du
// menu, tableau de bord)
import { useEffect } from "react";

import { useAppStore } from "@/state/hooks";

import { startPolling } from "./state";

export function useVeillePolling() {
  const netKnown = useAppStore((state) => state.net !== null);
  useEffect(() => {
    if (!netKnown) return;
    return startPolling();
  }, [netKnown]);
}
