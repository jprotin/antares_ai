// Présidentielle 2027 : page des candidats (lot 1), avec les sous-pages Candidats,
// Assistant (lot 2), Quiz (lot 3) et Méthode. Seul point de branchement :
// app/features.ts.
import { Landmark } from "lucide-react";

import type { FeatureDef } from "@/app/types";

import { AssistantPage } from "./AssistantPage";
import { CandidatesPage } from "./CandidatesPage";
import { PAGE_TITLE } from "./labels";
import { MethodPage } from "./MethodPage";
import { QuizPage } from "./QuizPage";

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
      { path: "assistant", title: "Assistant", render: AssistantPage },
      { path: "quiz", title: "Quiz", render: QuizPage },
      { path: "methode", title: "Méthode", render: MethodPage },
    ],
  },
};
