// Grille de l'écran : la scène de l'appel à gauche, la conversation à droite (empilées
// sur écran étroit). Le contenu de la scène et de la conversation arrive au lot 3.
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/state/hooks";

import { DialogHost } from "./DialogHost";
import { Toolbar } from "./Toolbar";

export function AppShell() {
  const callState = useAppStore((state) => state.callState);
  const status = useAppStore((state) => state.status);
  return (
    <main
      data-testid="app"
      data-state={callState}
      className="grid min-h-full gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
    >
      <section aria-label="Appel" className="flex flex-col gap-6">
        <div className="flex items-center justify-end">
          <Toolbar />
        </div>
        <header className="text-center">
          <h1 className="text-2xl font-semibold">Antares</h1>
          <p data-testid="status" role="status" aria-live="polite">
            {status}
          </p>
        </header>
        <div className="flex justify-center">
          <Button data-testid="call" size="lg" disabled>
            Appeler
          </Button>
        </div>
      </section>
      <section aria-label="Conversation écrite" />
      <DialogHost />
    </main>
  );
}
