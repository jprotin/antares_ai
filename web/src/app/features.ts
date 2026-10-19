// REGISTRE : seul fichier partagé touché pour brancher une fonctionnalité
import type { FeatureDef } from "./types";

import { agentsFeature } from "@/features/agents";
import { connectionsFeature } from "@/features/connections";
import { knowledgeFeature } from "@/features/knowledge";
import { ragProjectsFeature } from "@/features/rag-projects";
import { rehearsalFeature } from "@/features/rehearsal";
import { settingsFeature } from "@/features/settings";
import { themeFeature } from "@/features/theme";

export const features: FeatureDef[] = [
  themeFeature,
  settingsFeature,
  agentsFeature,
  connectionsFeature,
  knowledgeFeature,
  ragProjectsFeature,
  rehearsalFeature,
];
