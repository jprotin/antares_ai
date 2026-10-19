// Contrat du registre des fonctionnalités (critère RF-6) : une fonctionnalité déclare
// son bouton de barre, ses fenêtres et son panneau ; le socle les rend.
import type { ComponentType, SVGProps } from "react";

import type { CallEngine } from "@/engines/realtime/CallEngine";
import type { CallPlugin } from "@/engines/realtime/plugins";

export type ToolbarItem =
  | { order: number; render: ComponentType }
  | {
      order: number;
      opens: string;
      label: string;
      icon: ComponentType<SVGProps<SVGSVGElement>>;
    };

export type DialogDef = {
  id: string;
  render: ComponentType;
  // Classes du contenu (largeur propre à la fenêtre)
  className?: string;
  // Identifiant du <dialog> hérité, repris sur le contenu (ciblé par les tests)
  elementId?: string;
};

export type FeatureDef = {
  id: string;
  toolbar?: ToolbarItem;
  dialogs?: DialogDef[];
  // Panneau rendu dans la grille, après la conversation (il gère sa visibilité)
  panel?: ComponentType;
  // Branché sur l'appel au démarrage (Répétition : micro retenu, silence, coupure)
  callPlugin?: (engine: CallEngine) => CallPlugin;
};
