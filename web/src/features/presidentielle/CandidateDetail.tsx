// Fiche détaillée d'un candidat, dans la sous-page Candidats (pas d'adresse propre) :
// les thèmes servis dans leur ordre (ceux de la grille, sinon ceux déduits des mesures),
// chaque citation avec sa nature et sa source ; « Autres mesures » pour un thème absent
// de la liste, « Aucune mesure relue à ce jour » pour une fiche sans mesure ;
// rubrique des votes pour un parlementaire seulement. Onglets « Fiche » et « Évolution »
// (versions de la fiche, documents de programme), identiques pour chaque candidat. À
// l'ouverture, le focus va sur le nom (titre de la fiche) et la fiche défile en haut.
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { CandidateAvatar, StatusBadge } from "./CandidateCard";
import { EvolutionView } from "./Evolution";
import { EntreToursMark } from "./EntreToursMark";
import {
  formatDate,
  NO_HEADLINE,
  NO_MEASURE,
  NO_POSITION,
  OTHER_MEASURES,
  POSITION_LABEL,
} from "./labels";
import { NatureTag } from "./NatureTag";
import { Section } from "./Section";
import { SourceLink } from "./SourceLink";
import type { Candidat, Mesure } from "./types";

function MesureItem({
  mesure,
  showTheme = false,
}: {
  mesure: Mesure;
  showTheme?: boolean;
}) {
  return (
    <li className="grid gap-1" data-mesure={mesure.id}>
      <blockquote className="presidentielle-citation">
        {mesure.citation}
      </blockquote>
      <div className="presidentielle-meta">
        {showTheme && (
          <Badge variant="outline" data-theme={mesure.theme}>
            {mesure.theme_libelle ?? mesure.theme}
          </Badge>
        )}
        <NatureTag nature={mesure.nature} />
        <SourceLink source={mesure.source} page={mesure.page} />
        <EntreToursMark mesure={mesure} />
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
  // Mesures d'un thème absent de la liste servie : jamais masquées
  const known = new Set(themes.map((theme) => theme.id));
  const others = candidat.mesures.filter((m) => !known.has(m.theme));

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
      <Tabs defaultValue="fiche" className="gap-4">
        <TabsList aria-label="Vues de la fiche">
          <TabsTrigger value="fiche">Fiche</TabsTrigger>
          <TabsTrigger value="evolution">Évolution</TabsTrigger>
        </TabsList>
        <TabsContent value="fiche" className="grid gap-4 text-base">
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
          {!candidat.mesures.length && (
            <p
              className="presidentielle-manque"
              data-testid="presidentielle-sans-mesure"
            >
              {NO_MEASURE}
            </p>
          )}
          <div className="grid gap-4" data-testid="presidentielle-themes">
            {themes.map((theme) => {
              const mesures = candidat.mesures.filter(
                (m) => m.theme === theme.id,
              );
              return (
                <Section
                  key={theme.id}
                  title={theme.libelle}
                  data-theme={theme.id}
                >
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
            {others.length > 0 && (
              <Section title={OTHER_MEASURES} data-theme="autres">
                <ul className="grid gap-3">
                  {others.map((mesure) => (
                    <MesureItem key={mesure.id} mesure={mesure} showTheme />
                  ))}
                </ul>
              </Section>
            )}
          </div>
          {candidat.parlementaire && <Votes candidat={candidat} />}
        </TabsContent>
        <TabsContent value="evolution" className="text-base">
          <EvolutionView candidat={candidat} themes={themes} />
        </TabsContent>
      </Tabs>
    </article>
  );
}
