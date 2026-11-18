// Zone d'appel (pages Conversation et Répétition en cours) : la scène à gauche, la
// conversation à droite (empilées sur écran étroit), panneaux des fonctionnalités
// (Répétition). Une seule zone affichée à la fois : l'avatar y est monté.
import { features } from "@/app/features";
import { ConversationPanel } from "@/features/conversation";
import { Pickers } from "@/features/pickers";
import { useAppStore } from "@/state/hooks";

import { CallStage } from "./CallStage";

export function Workspace() {
  // Lu au rendu (pas à l'import : le registre importe cette fonctionnalité)
  const panels = features.flatMap((feature) =>
    feature.panel ? [{ id: feature.id, Panel: feature.panel }] : [],
  );
  const rootData = useAppStore((state) => state.rootData);
  const callState = useAppStore((state) => state.callState);
  const dataAttributes = Object.fromEntries(
    Object.entries(rootData).map(([key, value]) => [`data-${key}`, value]),
  );
  return (
    <div className="app" data-state={callState} {...dataAttributes}>
      <section className="stage" aria-label="Appel">
        <div className="stage__bar">
          <Pickers />
        </div>
        <CallStage />
      </section>
      <ConversationPanel />
      {panels.map(({ id, Panel }) => (
        <Panel key={id} />
      ))}
    </div>
  );
}
