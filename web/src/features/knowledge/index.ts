import type { FeatureDef } from "@/app/types";

import { KnowledgeEditDialog } from "./KnowledgeEditDialog";

export { KnowledgePanelDialog } from "./KnowledgePanelDialog";
export { proposeFromConversation, proposeFromDocument } from "./knowledge";

export const knowledgeFeature: FeatureDef = {
  id: "knowledge",
  dialogs: [
    {
      id: "knowledge-edit",
      render: KnowledgeEditDialog,
      className: "settings agents",
      elementId: "knowledge-edit",
    },
  ],
};
