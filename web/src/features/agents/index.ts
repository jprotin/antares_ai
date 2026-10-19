import type { FeatureDef } from "@/app/types";

import { AgentsDialog } from "./AgentsDialog";

// Ouverte depuis Réglages (« Gérer les agents »)
export const agentsFeature: FeatureDef = {
  id: "agents",
  dialogs: [
    { id: "agents", render: AgentsDialog, className: "settings agents" },
  ],
};
