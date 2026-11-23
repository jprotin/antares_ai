// Carte d'un candidat : même gabarit et mêmes classes pour tous (neutralité). Rubriques
// fixes (data-rubrique) : initiales, nom, statut, description, lignes phares, mise à
// jour ; un manque est affiché, jamais masqué.
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { formatDate, NO_HEADLINE, STATUT_LABEL } from "./labels";
import { NatureTag } from "./NatureTag";
import { SourceLink } from "./SourceLink";
import type { Candidat } from "./types";

export function CandidateAvatar({ candidat }: { candidat: Candidat }) {
  return (
    <Avatar size="lg" aria-hidden>
      <AvatarFallback>{candidat.initiales}</AvatarFallback>
    </Avatar>
  );
}

export function StatusBadge({ candidat }: { candidat: Candidat }) {
  return <Badge variant="outline">{STATUT_LABEL[candidat.statut]}</Badge>;
}

export function CandidateCard({
  candidat,
  onOpen,
}: {
  candidat: Candidat;
  onOpen: (id: string) => void;
}) {
  return (
    <Card
      className="w-full"
      data-testid="presidentielle-card"
      data-candidat={candidat.id}
    >
      <CardHeader className="grid-cols-[auto_1fr] items-center gap-x-3">
        <div data-rubrique="initiales" className="row-span-2">
          <CandidateAvatar candidat={candidat} />
        </div>
        <CardTitle data-rubrique="nom">
          <h3>{candidat.nom_affiche}</h3>
        </CardTitle>
        <div data-rubrique="statut">
          <StatusBadge candidat={candidat} />
        </div>
      </CardHeader>
      <CardContent className="grid flex-1 content-start gap-3">
        <div
          data-rubrique="description"
          className="grid justify-items-start gap-1"
        >
          <p>{candidat.description.texte}</p>
          <NatureTag nature={candidat.description.nature} />
        </div>
        <div data-rubrique="lignes-phares" className="grid gap-1">
          <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Lignes phares
          </h4>
          {candidat.lignes_phares.length ? (
            <ul className="grid gap-2">
              {candidat.lignes_phares.map((ligne, index) => (
                <li key={index} className="grid gap-1">
                  <span>{ligne.texte}</span>
                  <div className="presidentielle-meta">
                    <NatureTag nature={ligne.nature} />
                    <SourceLink source={ligne.source} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="presidentielle-manque">{NO_HEADLINE}</p>
          )}
        </div>
        <p data-rubrique="mise-a-jour" className="presidentielle-note">
          Mise à jour le {formatDate(candidat.mise_a_jour)}
        </p>
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          variant="outline"
          size="sm"
          data-open
          onClick={() => onOpen(candidat.id)}
          aria-label={`Voir la fiche de ${candidat.nom_affiche}`}
        >
          Voir la fiche
        </Button>
      </CardFooter>
    </Card>
  );
}
