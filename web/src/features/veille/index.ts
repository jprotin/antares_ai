// Veille IA et météo (service antares-tasks) : page Actualités avec pastille dans le
// menu. Seul point de branchement : app/features.ts.
import { Newspaper } from "lucide-react";

import type { FeatureDef } from "@/app/types";

import { VeilleBadge } from "./VeilleBadge";
import { VeillePage } from "./VeillePage";
import { VEILLE_LABEL } from "./veille";

// Pour le tableau de bord (features/home)
export { useVeillePolling } from "./polling";
export { veilleStore } from "./state";
export {
  categoryLabel,
  dayItems,
  degrees,
  formatDay,
  formatTime,
  parseDay,
  parseStamp,
  safeHref,
  weatherArt,
  weatherLabel,
} from "./veille";
export { WeatherArt } from "./WeatherArt";

export const veilleFeature: FeatureDef = {
  id: "veille",
  page: {
    path: "actualites",
    title: "Actualités",
    icon: Newspaper,
    order: 40,
    placement: "main",
    render: VeillePage,
    label: VEILLE_LABEL,
    badge: VeilleBadge,
  },
};
