// Titre et bouton Fermer d'un écran affiché en fenêtre ou en page (app/surface.ts) :
// en fenêtre, ceux de Radix (nom accessible, fermeture) ; en page, le titre seul et pas
// de bouton Fermer (on change de page par le menu).
import { Dialog } from "radix-ui";
import type { ReactElement } from "react";

import { useSurface } from "@/app/surface";

export function SurfaceTitle({ children }: { children: ReactElement }) {
  return useSurface() === "dialog" ? (
    <Dialog.Title asChild>{children}</Dialog.Title>
  ) : (
    children
  );
}

export function SurfaceClose({ children }: { children: ReactElement }) {
  return useSurface() === "dialog" ? (
    <Dialog.Close asChild>{children}</Dialog.Close>
  ) : null;
}
