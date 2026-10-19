// Fenêtre Réglages : coquille du lot 2 (avatar, voix, modèle et projet au lot 5)
import { Button } from "@/components/ui/button";
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function SettingsDialog() {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Réglages</DialogTitle>
        <DialogDescription>
          Avatar, voix, modèle et projet du RAG.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Fermer</Button>
        </DialogClose>
      </DialogFooter>
    </>
  );
}
