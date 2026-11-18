// Veille IA et météo (service antares-tasks) : bouton de barre avec pastille, fenêtre
// plein écran. Seul point de branchement : app/features.ts.
import type { FeatureDef } from "@/app/types";

import { VeilleButton } from "./VeilleButton";
import { VeilleDialog } from "./VeilleDialog";

export const veilleFeature: FeatureDef = {
  id: "veille",
  // Entre Répétition (20) et Réglages (30)
  toolbar: { order: 25, render: VeilleButton },
  dialogs: [
    {
      id: "veille",
      render: VeilleDialog,
      className: "settings veille",
      elementId: "veille",
    },
  ],
};
