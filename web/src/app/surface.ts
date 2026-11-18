// Surface d'un contenu : fenêtre (Radix Dialog) ou page de l'application. Un même écran
// (Réglages, Veille…) s'affiche dans l'une ou l'autre ; titre et bouton Fermer s'adaptent
// (components/Surface.tsx).
import { createContext, useContext } from "react";

export type Surface = "dialog" | "page";

export const SurfaceContext = createContext<Surface>("dialog");

export const useSurface = () => useContext(SurfaceContext);
