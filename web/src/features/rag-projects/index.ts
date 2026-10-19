import type { FeatureDef } from "@/app/types";

import { RagProjectsDialog } from "./RagProjectsDialog";

export const ragProjectsFeature: FeatureDef = {
  id: "rag-projects",
  dialogs: [
    {
      id: "rag-projects",
      render: RagProjectsDialog,
      className: "settings agents",
      elementId: "rag-projects",
    },
  ],
};
