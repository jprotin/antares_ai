// Marque « Entre les deux tours » d'une mesure ajoutée après le premier tour (le routeur
// la pose seulement quand la base est passée à l'entre-deux-tours) : la même dans la
// fiche, l'assistant et l'évolution
import { Badge } from "@/components/ui/badge";

import { ENTRE_TOURS, formatDate } from "./labels";
import type { MesureForme } from "./types";

export function EntreToursMark({
  mesure,
}: {
  mesure: Pick<MesureForme, "entre_tours" | "ajoutee_le">;
}) {
  if (!mesure.entre_tours) return null;
  return (
    <Badge variant="secondary" data-entre-tours="">
      {ENTRE_TOURS}
      {mesure.ajoutee_le ? `, ajoutée le ${formatDate(mesure.ajoutee_le)}` : ""}
    </Badge>
  );
}
