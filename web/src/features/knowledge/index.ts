import type { FeatureDef } from "@/app/types";

import { KnowledgeEditDialog } from "./KnowledgeEditDialog";
import { KnowledgePanelDialog } from "./KnowledgePanelDialog";

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
    {
      id: "knowledge-panel",
      render: KnowledgePanelDialog,
      className: "settings agents",
      elementId: "knowledge-panel",
    },
  ],
};
