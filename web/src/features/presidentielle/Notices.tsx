// Bandeaux d'avertissement de la page (outil personnel, données fictives, base vide,
// invité d'un partage, déploiement cloud) et version de la base en pied de page
import { Cloud, FlaskConical, Info, Share2, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import type { BasePubliee, Meta } from "./types";

function Notice({
  id,
  icon,
  title,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Alert role="note" data-notice={id}>
      {icon}
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function Notices({
  base,
  meta,
}: {
  base: BasePubliee | null;
  meta: Meta | null;
}) {
  const jeu = base?.jeu ?? meta?.jeu ?? null;
  const empty = base?.disponible && jeu === "reel" && !base.candidats.length;
  return (
    <div className="grid gap-2" data-testid="presidentielle-notices">
      <Notice
        id="personnel"
        icon={<Info aria-hidden />}
        title="Outil personnel, relu par une seule personne"
      >
        Cette page n'est ni un site officiel ni un média : les fiches sont
        tirées des documents publiés par les candidats et des sources
        officielles, puis relues par une seule personne. Elle ne donne aucune
        recommandation de vote.
      </Notice>
      {jeu === "demonstration" && (
        <Notice
          id="fictif"
          icon={<FlaskConical aria-hidden />}
          title="Données fictives"
        >
          Les candidats, partis, positions et documents affichés sont inventés
          pour la démonstration. Aucun ne correspond à une personne réelle.
        </Notice>
      )}
      {empty && (
        <Notice
          id="vide"
          icon={<Info aria-hidden />}
          title="Aucune fiche publiée à ce jour"
        >
          Les fiches apparaîtront ici une fois relues et publiées.
        </Notice>
      )}
      {base && !base.disponible && (
        <Notice
          id="indisponible"
          icon={<TriangleAlert aria-hidden />}
          title="Base indisponible"
        >
          {base.message ?? "La base des candidats n'a pas pu être lue."}
        </Notice>
      )}
      {meta?.guest && (
        <Notice
          id="invite"
          icon={<Share2 aria-hidden />}
          title="Vous consultez cette page par un partage temporaire"
        >
          Ce partage passe par le service ngrok : ce que vous consultez ou
          envoyez traverse ses serveurs, et l'inspecteur local de ngrok en garde
          une copie sur le poste du propriétaire le temps du partage.
        </Notice>
      )}
      {meta?.cible === "cloud" && (
        <Notice
          id="cloud"
          icon={<Cloud aria-hidden />}
          title="Déploiement cloud"
        >
          Cette page est servie par une machine distante, pas par un poste local
          : les échanges avec elle quittent votre ordinateur.
        </Notice>
      )}
    </div>
  );
}

export function BaseVersion({ version }: { version: string }) {
  if (!version) return null;
  return (
    <p className="presidentielle-note" data-testid="presidentielle-version">
      Version de la base : <code>{version.slice(0, 12)}</code>
    </p>
  );
}
