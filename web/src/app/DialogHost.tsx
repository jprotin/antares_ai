// Fenêtres déclarées par le registre : une seule ouverte à la fois (tranche ui)
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAppStore } from "@/state/hooks";
import { store } from "@/state/store";

import { features } from "./features";

const dialogs = features.flatMap((feature) => feature.dialogs ?? []);

export function DialogHost() {
  const open = useAppStore((state) => state.openDialog);
  return (
    <>
      {dialogs.map(({ id, render: Content, className }) => (
        <Dialog
          key={id}
          open={open === id}
          onOpenChange={(next) => {
            if (!next) store.getState().closeDialog();
          }}
        >
          <DialogContent className={className}>
            <Content />
          </DialogContent>
        </Dialog>
      ))}
    </>
  );
}
