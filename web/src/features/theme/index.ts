import type { FeatureDef } from "@/app/types";

import { ThemeToggle } from "./ThemeToggle";

export const themeFeature: FeatureDef = {
  id: "theme",
  toolbar: { order: 10, render: ThemeToggle },
};
