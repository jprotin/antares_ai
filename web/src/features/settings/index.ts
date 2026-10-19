import type { FeatureDef } from "@/app/types";
import { SettingsIcon } from "@/components/icons";

import { SettingsDialog } from "./SettingsDialog";

export const settingsFeature: FeatureDef = {
  id: "settings",
  toolbar: {
    order: 30,
    opens: "settings",
    label: "Réglages",
    icon: SettingsIcon,
  },
  dialogs: [{ id: "settings", render: SettingsDialog }],
};
