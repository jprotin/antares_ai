// Bandeaux d'avertissement de la page (outil personnel, données fictives, base vide,
// invité d'un partage, déploiement cloud), nouveautés de la surveillance pour le
// propriétaire, et version de la base en pied de page
import {
  Archive,
  Cloud,
  FileSearch,
  FlaskConical,
  Info,
  Share2,
  TriangleAlert,
  Vote,
} from "lucide-react";
import type { ReactNode } from "react";
import { useStore } from "zustand";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { formatDate, safeUrl } from "./labels";
import { presidentielleStore } from "./state";
import type { BasePubliee, Meta, Signalement } from "./types";

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

const DATE_HEURE = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Paris",
});

function detectedOn(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : DATE_HEURE.format(date);
}

// Signalements de la surveillance quotidienne : rien n'est publié, la relecture et la
// saisie restent à faire avec l'outil de saisie
function NewSources({ items }: { items: Signalement[] }) {
  return (
    <Notice
      id="nouveautes"
      icon={<FileSearch aria-hidden />}
      title="Nouvelle source à relire"
    >
      <p>
        La surveillance quotidienne a vu changer{" "}
        {items.length > 1 ? `${items.length} pages suivies` : "une page suivie"}{" "}
        depuis la dernière relecture de la fiche. Rien n'est publié avant votre
        relecture.
      </p>
      <ul className="grid gap-1">
        {items.map((item) => {
          const href = safeUrl(item.url);
          return (
            <li key={item.url} data-nouveaute={item.candidat}>
              {item.nom} :{" "}
              {href ? (
                <a
                  className="presidentielle-source__lien"
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {item.url}
                </a>
              ) : (
                <span>{item.url}</span>
              )}
              , détectée le {detectedOn(item.detecte_le)}
            </li>
          );
        })}
      </ul>
    </Notice>
  );
}

export function Notices({
  base,
  meta,
}: {
  base: BasePubliee | null;
  meta: Meta | null;
}) {
  const nouveautes = useStore(presidentielleStore, (state) => state.nouveautes);
  const jeu = base?.jeu ?? meta?.jeu ?? null;
  const phase = base?.phase ?? meta?.phase ?? null;
  const qualifies = (base?.qualifies ?? meta?.qualifies ?? []).length === 2;
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
      {phase === "archive" && (
        <Notice
          id="archive"
          icon={<Archive aria-hidden />}
          title={
            base?.archive_apres
              ? `Base figée au ${formatDate(base.archive_apres)}`
              : "Base figée"
          }
        >
          L'élection est passée : plus rien n'est publié, sauf une correction
          inscrite au journal de la page Méthode. Les fiches, l'assistant et le
          quiz restent consultables tels qu'ils étaient à cette date.
        </Notice>
      )}
      {(phase === "entre_tours" || (phase === "archive" && qualifies)) && (
        <Notice
          id="entre-tours"
          icon={<Vote aria-hidden />}
          title={
            phase === "archive"
              ? "Les deux candidats du second tour"
              : "Entre les deux tours"
          }
        >
          Seuls les deux candidats qualifiés pour le second tour sont présentés,
          dans la liste, l'assistant et le quiz. Les propositions ajoutées après
          le premier tour portent la mention « Entre les deux tours ».
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
      {meta && !meta.guest && nouveautes.length > 0 && (
        <NewSources items={nouveautes} />
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
