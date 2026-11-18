// Contrat du registre des fonctionnalités (critère RF-6) : une fonctionnalité déclare
// sa page (entrée du menu), ses fenêtres et son panneau ; le socle les rend.
import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

import type { CallEngine } from "@/engines/realtime/CallEngine";
import type { CallPlugin } from "@/engines/realtime/plugins";

export type DialogDef = {
  id: string;
  render: ComponentType;
  // Classes du contenu (largeur propre à la fenêtre)
  className?: string;
  // Identifiant du <dialog> hérité, repris sur le contenu (ciblé par les tests)
  elementId?: string;
};

// Sous-page d'une entrée du menu (ex. Réglages > Agents) : adresse #/<page>/<path>
export type SubPageDef = {
  path: string;
  title: string;
  render: ComponentType;
  // Nom de la zone de la page (titre de l'ancienne fenêtre, ciblé par les tests)
  label?: string;
};

// Page de l'application et son entrée dans le menu de gauche (app/AppSidebar.tsx)
export type PageDef = {
  path: string;
  title: string;
  icon: LucideIcon;
  // Rang dans sa zone du menu
  order: number;
  // Haut du menu, ou pied (Réglages)
  placement: "main" | "footer";
  // Contenu de la page ; absent si elle n'a que des sous-pages (la première s'affiche)
  render?: ComponentType;
  label?: string;
  children?: SubPageDef[];
  // Pastille à côté de l'entrée (nouvelle veille…)
  badge?: ComponentType;
};

export type FeatureDef = {
  id: string;
  page?: PageDef;
  dialogs?: DialogDef[];
  // Panneau rendu dans la grille, après la conversation (il gère sa visibilité)
  panel?: ComponentType;
  // Branché sur l'appel au démarrage (Répétition : micro retenu, silence, coupure)
  callPlugin?: (engine: CallEngine) => CallPlugin;
};
