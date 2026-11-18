// Accueil (tableau de bord), première entrée du menu. Seul point de branchement :
// app/features.ts.
import { House } from "lucide-react";

import type { FeatureDef } from "@/app/types";

import { HomePage } from "./HomePage";

export const homeFeature: FeatureDef = {
  id: "home",
  page: {
    path: "accueil",
    title: "Accueil",
    icon: House,
    order: 10,
    placement: "main",
    render: HomePage,
  },
};
