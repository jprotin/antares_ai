// Page Conversation : la zone d'appel (scène, conversation). Seul point de branchement :
// app/features.ts.
import { MessagesSquare } from "lucide-react";

import type { FeatureDef } from "@/app/types";

import { Workspace } from "./Workspace";

export { Workspace } from "./Workspace";

export const callFeature: FeatureDef = {
  id: "call",
  page: {
    path: "conversation",
    title: "Conversation",
    icon: MessagesSquare,
    order: 20,
    placement: "main",
    render: Workspace,
  },
};
