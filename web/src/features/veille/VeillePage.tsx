// Page Actualités : la Veille IA et météo en pleine largeur (mini-fenêtre du journal en
// haut à gauche, météo, articles, idées ; statistiques et sources en fenêtres).
import { SurfaceContext } from "@/app/surface";

import { VeilleDialog } from "./VeilleDialog";
import { VEILLE_LABEL } from "./veille";

export function VeillePage() {
  return (
    <SurfaceContext.Provider value="page">
      <section id="veille" aria-label={VEILLE_LABEL} className="veille-page">
        <VeilleDialog />
      </section>
    </SurfaceContext.Provider>
  );
}
