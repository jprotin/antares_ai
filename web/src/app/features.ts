// REGISTRE : seul fichier partagé touché pour brancher une fonctionnalité (page et entrée
// du menu, fenêtres, panneau, plugin d'appel)
import type { FeatureDef } from "./types";

import { callFeature } from "@/features/call";
import { homeFeature } from "@/features/home";
import { knowledgeFeature } from "@/features/knowledge";
import { rehearsalFeature } from "@/features/rehearsal";
import { settingsFeature } from "@/features/settings";
import { veilleFeature } from "@/features/veille";

export const features: FeatureDef[] = [
  homeFeature,
  callFeature,
  rehearsalFeature,
  veilleFeature,
  settingsFeature,
  knowledgeFeature,
];
