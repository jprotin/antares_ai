import type { FeatureDef } from "@/app/types";

import { ConnectionsDialog } from "./ConnectionsDialog";

export const connectionsFeature: FeatureDef = {
  id: "connections",
  dialogs: [
    {
      id: "connections",
      render: ConnectionsDialog,
      className: "settings agents",
    },
  ],
};
