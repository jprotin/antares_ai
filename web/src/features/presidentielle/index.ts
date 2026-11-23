// Présidentielle 2027 : page des candidats (lot 1), avec les sous-pages Candidats et
// Méthode ; Assistant et Quiz viendront avec leur lot. Seul point de branchement :
// app/features.ts.
import { Landmark } from "lucide-react";

import type { FeatureDef } from "@/app/types";

import { CandidatesPage } from "./CandidatesPage";
import { PAGE_TITLE } from "./labels";
import { MethodPage } from "./MethodPage";

export const presidentielleFeature: FeatureDef = {
  id: "presidentielle",
  page: {
    path: "presidentielle-2027",
    title: PAGE_TITLE,
    icon: Landmark,
    order: 50,
    placement: "main",
    children: [
      { path: "candidats", title: "Candidats", render: CandidatesPage },
      { path: "methode", title: "Méthode", render: MethodPage },
    ],
  },
};
