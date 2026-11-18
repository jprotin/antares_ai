// Répétition d'une présentation : page (préparation, historique, répétition en cours),
// panneau et plugin d'appel. Seul point de branchement : app/features.ts.
import { Presentation } from "lucide-react";

import type { FeatureDef } from "@/app/types";

import { rehearsal } from "./instance";
import { RehearsalPage } from "./RehearsalPage";
import { RehearsalPanel } from "./RehearsalPanel";

// Pour le tableau de bord (dernière répétition)
export { rehearsal };

export const rehearsalFeature: FeatureDef = {
  id: "rehearsal",
  page: {
    path: "repetition",
    title: "Répétition",
    icon: Presentation,
    order: 30,
    placement: "main",
    render: RehearsalPage,
    label: "Répéter une présentation",
  },
  panel: RehearsalPanel,
  callPlugin: () => rehearsal.plugin(),
};
