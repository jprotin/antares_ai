// Contrat du registre des fonctionnalités (critère RF-6) : une fonctionnalité déclare
// son bouton de barre, ses fenêtres et son panneau ; le socle les rend.
import type { ComponentType, SVGProps } from "react";

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
};

export type FeatureDef = {
  id: string;
  toolbar?: ToolbarItem;
  dialogs?: DialogDef[];
  panel?: ComponentType;
};
