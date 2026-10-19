// Fenêtres déclarées par le registre : une seule ouverte à la fois (tranche ui).
// Primitives Radix habillées comme les <dialog> de l'ancienne interface (app/dialogs.css) :
// Échap, clic sur le fond, focus piégé puis rendu au bouton d'ouverture.
import { Dialog } from "radix-ui";

import { useAppStore } from "@/state/hooks";
import { store } from "@/state/store";

import { features } from "./features";
import "./dialogs.css";

const dialogs = features.flatMap((feature) => feature.dialogs ?? []);

export function DialogHost() {
  const open = useAppStore((state) => state.openDialog);
  return (
    <>
      {dialogs.map(({ id, render: Content, className }) => (
        <Dialog.Root
          key={id}
          open={open === id}
          onOpenChange={(next) => {
            if (!next) store.getState().closeDialog();
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-backdrop" />
            <Dialog.Content
              className={`dialog-panel ${className ?? ""}`}
              aria-describedby={undefined}
            >
              <Content />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ))}
    </>
  );
}
