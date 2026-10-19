// Répétition d'une présentation : bouton de barre, fenêtre de préparation, panneau et
// plugin d'appel. Seul point de branchement : app/features.ts.
import type { FeatureDef } from "@/app/types";

import { rehearsal } from "./instance";
import { OpenRehearsalButton } from "./OpenRehearsalButton";
import { RehearsalPanel } from "./RehearsalPanel";
import { SetupDialog } from "./SetupDialog";

export const rehearsalFeature: FeatureDef = {
  id: "rehearsal",
  toolbar: { order: 20, render: OpenRehearsalButton },
  dialogs: [
    {
      id: "rehearsal-setup",
      render: SetupDialog,
      className: "settings agents rehearsal-setup",
    },
  ],
  panel: RehearsalPanel,
  callPlugin: () => rehearsal.plugin(),
};
