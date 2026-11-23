// Fiche détaillée d'un candidat, dans la sous-page Candidats (pas d'adresse propre) :
// les dix thèmes dans l'ordre de la grille, chaque citation avec sa nature et sa source ;
// rubrique des votes pour un parlementaire seulement. À l'ouverture, le focus va sur le
// nom (titre de la fiche) et la fiche défile en haut.
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import { CandidateAvatar, StatusBadge } from "./CandidateCard";
import { formatDate, NO_HEADLINE, NO_POSITION, POSITION_LABEL } from "./labels";
import { NatureTag } from "./NatureTag";
import { Section } from "./Section";
import { SourceLink } from "./SourceLink";
import type { Candidat, Mesure } from "./types";

function MesureItem({ mesure }: { mesure: Mesure }) {
  return (
    <li className="grid gap-1" data-mesure={mesure.id}>
      <blockquote className="presidentielle-citation">
        {mesure.citation}
      </blockquote>
      <div className="presidentielle-meta">
        <NatureTag nature={mesure.nature} />
        <SourceLink source={mesure.source} page={mesure.page} />
      </div>
      {mesure.resume && (
        <p className="presidentielle-meta">
          <span>Résumé : {mesure.resume}</span>
          <NatureTag nature="redaction" />
        </p>
      )}
    </li>
  );
}

function Votes({ candidat }: { candidat: Candidat }) {
  return (
    <Section title="Votes au Parlement" data-rubrique="votes">
      <p className="presidentielle-note">
        Scrutins publics relevés sur les données ouvertes ; ils n'entrent pas
        dans le calcul du quiz.
      </p>
      {candidat.votes.length ? (
        <ul className="grid gap-3">
          {candidat.votes.map((vote) => (
            <li key={vote.id} className="grid gap-1" data-vote={vote.id}>
              <p>
                <strong>{POSITION_LABEL[vote.position]}</strong> —{" "}
                {vote.scrutin}, le {formatDate(vote.date)}
              </p>
              <SourceLink source={vote.source} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="presidentielle-manque">Aucun scrutin relevé à ce jour</p>
      )}
    </Section>
  );
}

export function CandidateDetail({
  candidat,
  themes,
  onBack,
}: {
  candidat: Candidat;
  themes: { id: string; libelle: string }[];
  onBack: () => void;
}) {
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    title.current?.focus();
    title.current?.scrollIntoView({ block: "start" });
  }, [candidat.id]);

  return (
    <article
      className="grid gap-4"
      data-testid="presidentielle-detail"
      data-candidat={candidat.id}
      aria-label={`Fiche de ${candidat.nom_affiche}`}
    >
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft aria-hidden />
          Retour à la liste
        </Button>
      </div>
      <header className="flex items-center gap-3">
        <CandidateAvatar candidat={candidat} />
        <div className="grid gap-1">
          <h2
            ref={title}
            tabIndex={-1}
            className="text-xl font-semibold outline-none"
          >
            {candidat.nom_affiche}
          </h2>
          <div className="presidentielle-meta">
            <StatusBadge candidat={candidat} />
            <SourceLink source={candidat.statut_source} />
          </div>
        </div>
      </header>
      <div className="grid justify-items-start gap-1">
        <p>{candidat.description.texte}</p>
        <NatureTag nature={candidat.description.nature} />
      </div>
      <p className="presidentielle-note">
        Candidature déclarée le {formatDate(candidat.declaration.date)} ; fiche
        mise à jour le {formatDate(candidat.mise_a_jour)}
        {candidat.relue_le ? `, relue le ${formatDate(candidat.relue_le)}` : ""}
      </p>
      <Section title="Lignes phares" data-rubrique="lignes-phares">
        {candidat.lignes_phares.length ? (
          <ul className="grid gap-3">
            {candidat.lignes_phares.map((ligne, index) => (
              <li key={index} className="grid gap-1">
                <p>{ligne.texte}</p>
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
      </Section>
      <Separator />
      <div className="grid gap-4" data-testid="presidentielle-themes">
        {themes.map((theme) => {
          const mesures = candidat.mesures.filter((m) => m.theme === theme.id);
          return (
            <Section key={theme.id} title={theme.libelle} data-theme={theme.id}>
              {mesures.length ? (
                <ul className="grid gap-3">
                  {mesures.map((mesure) => (
                    <MesureItem key={mesure.id} mesure={mesure} />
                  ))}
                </ul>
              ) : (
                <p className="presidentielle-manque">{NO_POSITION}</p>
              )}
            </Section>
          );
        })}
      </div>
      {candidat.parlementaire && <Votes candidat={candidat} />}
    </article>
  );
}
