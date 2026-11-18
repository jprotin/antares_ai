// Réglages, en pied du menu : réglages généraux (avatar, voix, modèle, projet), agents,
// connexions, projets du RAG intégré, fiches de connaissances. Seul point de
// branchement : app/features.ts.
import { Settings } from "lucide-react";

import type { FeatureDef } from "@/app/types";

import {
  AgentsPage,
  ConnectionsPage,
  GeneralPage,
  KnowledgePage,
  RagProjectsPage,
} from "./pages";

export const settingsFeature: FeatureDef = {
  id: "settings",
  page: {
    path: "reglages",
    title: "Réglages",
    icon: Settings,
    order: 10,
    placement: "footer",
    children: [
      { path: "general", title: "Général", render: GeneralPage },
      { path: "agents", title: "Agents", render: AgentsPage },
      { path: "connexions", title: "Connexions", render: ConnectionsPage },
      { path: "projets-rag", title: "Projets RAG", render: RagProjectsPage },
      {
        path: "connaissances",
        title: "Connaissances",
        render: KnowledgePage,
      },
    ],
  },
};
