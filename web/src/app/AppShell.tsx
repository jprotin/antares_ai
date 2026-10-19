// Grille de l'écran : la scène de l'appel à gauche, la conversation à droite (empilées
// sur écran étroit) ; fenêtres déclarées par le registre
import { CallStage } from "@/features/call";
import { ConversationPanel } from "@/features/conversation";
import { NetIndicator } from "@/features/net";
import { Pickers } from "@/features/pickers";
import { useAppStore } from "@/state/hooks";

import { DialogHost } from "./DialogHost";
import { features } from "./features";
import { Toolbar } from "./Toolbar";
import "./shell.css";

const panels = features.flatMap((feature) =>
  feature.panel ? [{ id: feature.id, Panel: feature.panel }] : [],
);

// Identifiant du conteneur des portails propres à une fonctionnalité (visionneuse de
// slides) : dans #root, donc soumis aux règles d'impression de la fonctionnalité
export const FEATURE_PORTAL_ID = "feature-portal";

export function AppShell() {
  const callState = useAppStore((state) => state.callState);
  const rootData = useAppStore((state) => state.rootData);
  const dataAttributes = Object.fromEntries(
    Object.entries(rootData).map(([key, value]) => [`data-${key}`, value]),
  );
  return (
    <main
      className="app"
      data-testid="app"
      data-state={callState}
      {...dataAttributes}
    >
      <section className="stage" aria-label="Appel">
        <div className="stage__bar">
          <Pickers />
          <div className="stage__tools">
            <NetIndicator />
            <Toolbar />
          </div>
        </div>
        <CallStage />
      </section>
      <ConversationPanel />
      {panels.map(({ id, Panel }) => (
        <Panel key={id} />
      ))}
      <DialogHost />
      <div id={FEATURE_PORTAL_ID} />
    </main>
  );
}
