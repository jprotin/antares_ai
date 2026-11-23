// État de lecture commun aux sous-pages : squelette tant que rien n'est lu, alerte
// « Lecture impossible » avec « Réessayer » en cas d'échec (la base déjà lue reste
// affichée par la page, cf. state.ts)
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { loadPresidentielle } from "./state";

export function LoadState({
  status,
  error,
  loaded,
}: {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  loaded: boolean;
}) {
  if (status === "error")
    return (
      <Alert
        variant="destructive"
        role="alert"
        data-testid="presidentielle-erreur"
      >
        <AlertTitle>Lecture impossible</AlertTitle>
        <AlertDescription>
          <p>La base n'a pas pu être lue : {error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadPresidentielle()}
          >
            Réessayer
          </Button>
        </AlertDescription>
      </Alert>
    );
  if (loaded) return null;
  return (
    <div
      className="presidentielle-grid"
      aria-busy="true"
      aria-label="Chargement"
    >
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-48 w-full" />
      ))}
    </div>
  );
}
