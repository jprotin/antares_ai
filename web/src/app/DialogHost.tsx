// Fenêtres déclarées par le registre, empilées (tranche ui).
// Primitives Radix habillées comme les <dialog> de l'ancienne interface (app/dialogs.css) :
// Échap, clic sur le fond, focus piégé puis rendu au bouton d'ouverture.
import { Dialog } from "radix-ui";
import { memo, useCallback, useRef } from "react";

import { useAppStore } from "@/state/hooks";
import { store } from "@/state/store";

import { features } from "./features";
import type { DialogDef } from "./types";
import "./dialogs.css";

const dialogs = features.flatMap((feature) => feature.dialogs ?? []);

// Une fenêtre ne se re-rend que si elle s'ouvre ou se ferme : Radix réinscrirait sinon son
// calque en haut de la pile, et Échap fermerait une fenêtre du dessous
const DialogFrame = memo(function DialogFrame({
  def: { id, render: Content, className, elementId },
  open,
}: {
  def: DialogDef;
  open: boolean;
}) {
  // Élément qui avait le focus à l'ouverture (son bouton d'ouverture) : sans
  // Dialog.Trigger, Radix ne saurait pas où rendre le focus à la fermeture
  const opener = useRef<HTMLElement | null>(null);
  const onOpenChange = useCallback(
    (next: boolean) => {
      if (!next) store.getState().closeDialog(id);
    },
    [id],
  );
  const onOpenAutoFocus = useCallback(() => {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement ? active : null;
  }, []);
  const onCloseAutoFocus = useCallback((event: Event) => {
    if (!opener.current?.isConnected) return;
    event.preventDefault();
    opener.current.focus();
  }, []);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content
          id={elementId}
          className={`dialog-panel ${className ?? ""}`}
          aria-describedby={undefined}
          onOpenAutoFocus={onOpenAutoFocus}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <Content />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
});

export function DialogHost() {
  const open = useAppStore((state) => state.dialogs);
  return (
    <>
      {dialogs.map((def) => (
        <DialogFrame key={def.id} def={def} open={open.includes(def.id)} />
      ))}
    </>
  );
}
