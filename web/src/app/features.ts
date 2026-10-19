// REGISTRE : seul fichier partagé touché pour brancher une fonctionnalité
import type { FeatureDef } from "./types";

import { settingsFeature } from "@/features/settings";
import { themeFeature } from "@/features/theme";

export const features: FeatureDef[] = [themeFeature, settingsFeature];
