// Onglet « Évolution » d'une fiche (même gabarit pour chaque candidat) : frise des
// versions publiées, de la plus récente à la plus ancienne, avec les mesures ajoutées,
// retirées ou reformulées, les nouvelles sources et le changement de statut ; pour un
// document de programme en plusieurs versions, comparaison mot pour mot de deux
// versions choisies et version où chaque citation apparaît puis disparaît. Une mesure
// retirée parce qu'erronée n'est montrée que par la date de son retrait, dans toutes les
// versions (ni citation ni source). Calculs faits par le routeur ; ici, seulement le
// texte des fiches et des documents, sans résumé ni qualificatif.
import { type ReactNode, useEffect, useId, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { loadComparaison, loadEvolution } from "./api";
import { EntreToursMark } from "./EntreToursMark";
import {
  BLOC_LABEL,
  formatDate,
  BAD_COPY,
  NO_COPY,
  NO_PROGRAMME_VERSIONS,
  retireeErreur,
  retraitErreurLabel,
  STATUT_LABEL,
  themeLabel,
} from "./labels";
import { Section } from "./Section";
import { SourceLink } from "./SourceLink";
import type {
  BlocComparaison,
  Candidat,
  Changements,
  Comparaison,
  Evolution,
  MesureVersion,
  Programme,
  VersionDocument,
  VersionFiche,
} from "./types";

type Themes = Map<string, string>;

function Citation({
  mesure,
  themes,
}: {
  mesure: MesureVersion;
  themes: Themes;
}) {
  if (retireeErreur(mesure))
    return (
      <p
        className="presidentielle-note"
        data-mesure={mesure.id}
        data-retrait-erreur=""
      >
        {retraitErreurLabel(mesure.retrait_erreur)}
      </p>
    );
  return (
    <div className="grid gap-1" data-mesure={mesure.id}>
      <blockquote className="presidentielle-citation">
        {mesure.citation}
      </blockquote>
      <div className="presidentielle-meta">
        <Badge variant="outline">{themeLabel(mesure, themes)}</Badge>
        <SourceLink source={mesure.source} page={mesure.page} />
        <EntreToursMark mesure={mesure} />
      </div>
    </div>
  );
}

function ChangeList({
  title,
  kind,
  children,
}: {
  title: string;
  kind: string;
  children: ReactNode[];
}) {
  if (!children.length) return null;
  return (
    <div className="grid gap-2" data-changement={kind}>
      <h5 className="text-sm font-medium">
        {title} ({children.length})
      </h5>
      <ul className="grid gap-3">{children}</ul>
    </div>
  );
}

function Changes({
  changements,
  versionPrecedente,
  themes,
}: {
  changements: Changements;
  versionPrecedente: number | null;
  themes: Themes;
}) {
  const {
    mesures_ajoutees: ajoutees,
    mesures_retirees: retirees,
    mesures_reformulees: reformulees,
    nouvelles_sources: sources,
    statut,
  } = changements;
  const empty =
    !ajoutees.length &&
    !retirees.length &&
    !reformulees.length &&
    !sources.length &&
    !statut;
  return (
    <div className="grid gap-3">
      <p className="presidentielle-note">
        Par rapport à la version {versionPrecedente}
      </p>
      {statut && (
        <div className="presidentielle-meta" data-changement="statut">
          <span>
            Statut : {STATUT_LABEL[statut.avant] ?? statut.avant} →{" "}
            {STATUT_LABEL[statut.apres] ?? statut.apres}
          </span>
          <SourceLink source={statut.source} />
        </div>
      )}
      <ChangeList title="Mesures ajoutées" kind="ajoutees">
        {ajoutees.map((mesure) => (
          <li key={mesure.id}>
            <Citation mesure={mesure} themes={themes} />
          </li>
        ))}
      </ChangeList>
      <ChangeList title="Mesures retirées" kind="retirees">
        {retirees.map((mesure) => (
          <li key={mesure.id}>
            <Citation mesure={mesure} themes={themes} />
          </li>
        ))}
      </ChangeList>
      <ChangeList title="Mesures reformulées" kind="reformulees">
        {reformulees.map((change) =>
          retireeErreur(change.avant) && retireeErreur(change.apres) ? (
            <li key={change.id}>
              <Citation mesure={change.apres} themes={themes} />
            </li>
          ) : (
            <li key={change.id} className="grid gap-2">
              <p className="presidentielle-note">
                {change.citation_modifiee
                  ? "Citation modifiée"
                  : "Même citation, source ou page modifiée"}
              </p>
              <div className="grid gap-1">
                <span className="text-sm font-medium">Avant</span>
                <Citation mesure={change.avant} themes={themes} />
              </div>
              <div className="grid gap-1">
                <span className="text-sm font-medium">Après</span>
                <Citation mesure={change.apres} themes={themes} />
              </div>
            </li>
          ),
        )}
      </ChangeList>
      <ChangeList title="Nouvelles sources" kind="sources">
        {sources.map((source) => (
          <li key={source.id}>
            <SourceLink source={source} />
          </li>
        ))}
      </ChangeList>
      {empty && (
        <p className="presidentielle-manque">
          Aucune mesure, source ni statut modifié
        </p>
      )}
    </div>
  );
}

function VersionItem({
  version,
  themes,
}: {
  version: VersionFiche;
  themes: Themes;
}) {
  return (
    <li
      className="presidentielle-frise__version grid gap-2"
      data-version={version.version}
    >
      <h4 className="font-semibold">
        Version {version.version}
        {version.date ? `, ${formatDate(version.date)}` : ""}
      </h4>
      {version.motif ? (
        <p>Motif inscrit au journal : {version.motif}</p>
      ) : (
        <p className="presidentielle-manque">Aucun motif inscrit au journal</p>
      )}
      {!version.conservee && (
        <p className="presidentielle-manque" data-non-conservee="">
          {version.copie_en_defaut ? BAD_COPY : NO_COPY}
        </p>
      )}
      {version.conservee && !version.changements && (
        <p className="presidentielle-note">
          Première version conservée
          {typeof version.mesures === "number"
            ? ` : ${version.mesures} mesure${version.mesures > 1 ? "s" : ""}`
            : ""}
        </p>
      )}
      {version.changements && (
        <Changes
          changements={version.changements}
          versionPrecedente={version.comparee_a}
          themes={themes}
        />
      )}
    </li>
  );
}

function versionName(versions: VersionDocument[], id: string | null): string {
  const index = versions.findIndex((v) => v.id === id);
  if (index < 0) return "";
  const version = versions[index] as VersionDocument;
  const dated = version.publie_le
    ? `publiée le ${formatDate(version.publie_le)}`
    : `consultée le ${formatDate(version.consulte_le)}`;
  return `version ${index + 1} (${dated})`;
}

function Segments({ bloc }: { bloc: BlocComparaison }) {
  if (bloc.type === "ajoute")
    return (
      <p>
        <ins>
          <span className="sr-only">Ajouté : </span>
          {bloc.apres}
        </ins>
      </p>
    );
  if (bloc.type === "retire")
    return (
      <p>
        <del>
          <span className="sr-only">Retiré : </span>
          {bloc.avant}
        </del>
      </p>
    );
  if (!bloc.mots)
    return (
      <div className="grid gap-1">
        <p>
          <span className="font-medium">Avant : </span>
          {bloc.avant}
        </p>
        <p>
          <span className="font-medium">Après : </span>
          {bloc.apres}
        </p>
      </div>
    );
  return (
    <p>
      {bloc.mots.map((segment, index) => {
        const space = index ? " " : "";
        if (segment.type === "ajoute")
          return (
            <span key={index}>
              {space}
              <ins>
                <span className="sr-only">[ajouté : </span>
                {segment.texte}
                <span className="sr-only">]</span>
              </ins>
            </span>
          );
        if (segment.type === "retire")
          return (
            <span key={index}>
              {space}
              <del>
                <span className="sr-only">[retiré : </span>
                {segment.texte}
                <span className="sr-only">]</span>
              </del>
            </span>
          );
        return (
          <span key={index}>
            {space}
            {segment.texte}
          </span>
        );
      })}
    </p>
  );
}

function pagesOf(bloc: BlocComparaison): string {
  if (bloc.type === "modifie")
    return `page ${bloc.page_avant} → page ${bloc.page_apres}`;
  if (bloc.type === "retire") return `page ${bloc.page_avant} (départ)`;
  return `page ${bloc.page_apres} (arrivée)`;
}

function ComparisonView({
  comparaison,
  versions,
  de,
  a,
}: {
  comparaison: Comparaison;
  versions: VersionDocument[];
  de: string;
  a: string;
}) {
  const { blocs, inchanges, tronque } = comparaison;
  return (
    <div className="grid gap-3" data-testid="presidentielle-comparaison">
      <p className="presidentielle-note" role="status">
        De la {versionName(versions, de)} à la {versionName(versions, a)} :{" "}
        {blocs.length} passage{blocs.length > 1 ? "s" : ""} différent
        {blocs.length > 1 ? "s" : ""}, {inchanges} paragraphe
        {inchanges > 1 ? "s" : ""} identique{inchanges > 1 ? "s" : ""}
        {tronque ? " ; liste tronquée, voir les documents" : ""}.
      </p>
      {blocs.length ? (
        <ol className="presidentielle-diff grid gap-3">
          {blocs.map((bloc, index) => (
            <li key={index} className="grid gap-1" data-bloc={bloc.type}>
              <div className="presidentielle-meta">
                <Badge variant="outline">{BLOC_LABEL[bloc.type]}</Badge>
                <span className="presidentielle-note">{pagesOf(bloc)}</span>
              </div>
              <Segments bloc={bloc} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="presidentielle-manque">Textes identiques</p>
      )}
    </div>
  );
}

function VersionChoice({
  legend,
  versions,
  value,
  onChange,
}: {
  legend: string;
  versions: VersionDocument[];
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <RadioGroup value={value} onValueChange={onChange}>
        {versions.map((version) => (
          <div key={version.id} className="flex items-center gap-2">
            <RadioGroupItem
              id={`${id}-${version.id}`}
              value={version.id}
              disabled={!version.texte}
            />
            <Label htmlFor={`${id}-${version.id}`} className="font-normal">
              {versionName(versions, version.id)}
              {version.texte ? "" : " : texte non disponible"}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </fieldset>
  );
}

function presenceText(
  versions: VersionDocument[],
  id: string | null,
  page: number | null,
): string {
  if (!id) return "—";
  return `${versionName(versions, id)}${page ? `, page ${page}` : ""}`;
}

function ProgrammeView({
  candidat,
  programme,
  themes,
}: {
  candidat: string;
  programme: Programme;
  themes: Themes;
}) {
  const { versions } = programme;
  const withText = versions.filter((v) => v.texte);
  const [de, setDe] = useState(withText.at(-2)?.id ?? "");
  const [a, setA] = useState(withText.at(-1)?.id ?? "");
  const [result, setResult] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    comparaison?: Comparaison;
    pair?: [string, string];
    error?: string;
  }>({ status: "idle" });

  const compare = () => {
    setResult({ status: "loading" });
    loadComparaison(candidat, de, a)
      .then((comparaison) =>
        setResult({ status: "ready", comparaison, pair: [de, a] }),
      )
      .catch((error: unknown) =>
        setResult({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
  };

  return (
    <div className="grid gap-4" data-programme={versions.at(-1)?.id}>
      <h4 className="font-semibold">{programme.titre}</h4>
      <ol className="grid gap-2" aria-label="Versions du document">
        {versions.map((version, index) => (
          <li
            key={version.id}
            className="grid gap-1"
            data-document={version.id}
          >
            <span className="text-sm font-medium">Version {index + 1}</span>
            <SourceLink source={version} />
            {!version.texte && (
              <span className="presidentielle-manque">
                Texte non disponible pour la comparaison
              </span>
            )}
          </li>
        ))}
      </ol>
      {withText.length >= 2 ? (
        <div className="grid gap-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <VersionChoice
              legend="Version de départ"
              versions={versions}
              value={de}
              onChange={setDe}
            />
            <VersionChoice
              legend="Version d'arrivée"
              versions={versions}
              value={a}
              onChange={setA}
            />
          </div>
          <div>
            <Button
              size="sm"
              onClick={compare}
              disabled={!de || !a || de === a || result.status === "loading"}
            >
              Comparer les deux versions
            </Button>
          </div>
          <div aria-busy={result.status === "loading"}>
            {result.status === "loading" && (
              <Skeleton className="h-24 w-full" />
            )}
            {result.status === "error" && (
              <Alert variant="destructive" role="alert">
                <AlertTitle>Comparaison impossible</AlertTitle>
                <AlertDescription>{result.error}</AlertDescription>
              </Alert>
            )}
            {result.status === "ready" && result.comparaison && result.pair && (
              <ComparisonView
                comparaison={result.comparaison}
                versions={versions}
                de={result.pair[0]}
                a={result.pair[1]}
              />
            )}
          </div>
        </div>
      ) : (
        <p className="presidentielle-manque">
          Comparaison impossible : texte de moins de deux versions disponible
        </p>
      )}
      {programme.mesures.length > 0 && (
        <Table data-testid="presidentielle-parcours">
          <TableCaption>
            Citations de la fiche dans les versions du document (recherche mot
            pour mot)
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Citation</TableHead>
              <TableHead scope="col">
                Première version qui la contient
              </TableHead>
              <TableHead scope="col">
                Première version qui ne la contient plus
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {programme.mesures.map((parcours) => (
              <TableRow
                key={parcours.mesure.id}
                data-parcours={parcours.mesure.id}
              >
                <TableCell className="whitespace-normal">
                  <span className="text-muted-foreground">
                    {themeLabel(parcours.mesure, themes)} :{" "}
                  </span>
                  {parcours.mesure.citation}
                </TableCell>
                <TableCell className="whitespace-normal">
                  {parcours.premiere
                    ? parcours.premiere_incertaine
                      ? `Présente dans la ${presenceText(
                          versions,
                          parcours.premiere,
                          parcours.page_premiere,
                        )} ; texte des versions antérieures non disponible`
                      : presenceText(
                          versions,
                          parcours.premiere,
                          parcours.page_premiere,
                        )
                    : "Non trouvée dans les textes disponibles"}
                </TableCell>
                <TableCell className="whitespace-normal">
                  {presenceText(versions, parcours.disparue, null)}
                  {parcours.reapparue
                    ? ` ; de nouveau présente dans la ${presenceText(
                        versions,
                        parcours.reapparue,
                        null,
                      )}`
                    : ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export function EvolutionView({
  candidat,
  themes,
}: {
  candidat: Candidat;
  themes: { id: string; libelle: string }[];
}) {
  const [state, setState] = useState<{
    id: string;
    data: Evolution | null;
    error: string | null;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const names: Themes = new Map(themes.map((t) => [t.id, t.libelle]));

  useEffect(() => {
    let active = true;
    loadEvolution(candidat.id)
      .then((data) => {
        if (active) setState({ id: candidat.id, data, error: null });
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            id: candidat.id,
            data: null,
            error: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      active = false;
    };
  }, [candidat.id, attempt]);

  const current = state?.id === candidat.id ? state : null;
  return (
    <div className="grid gap-4" data-testid="presidentielle-evolution">
      <p className="presidentielle-note">
        Texte des fiches et des documents seulement, sans résumé ni
        appréciation. Les versions antérieures à la première copie conservée ne
        sont pas récupérables.
      </p>
      {!current && (
        <div aria-busy="true">
          <Skeleton className="h-48 w-full" />
        </div>
      )}
      {current?.error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Lecture impossible</AlertTitle>
          <AlertDescription>
            <p>L'évolution de la fiche n'a pas pu être lue : {current.error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setState(null);
                setAttempt((n) => n + 1);
              }}
            >
              Réessayer
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {current?.data && (
        <>
          <Section title="Versions de la fiche" data-rubrique="versions-fiche">
            <ol className="presidentielle-frise grid gap-4">
              {current.data.versions.map((version) => (
                <VersionItem
                  key={version.version}
                  version={version}
                  themes={names}
                />
              ))}
            </ol>
          </Section>
          <Section title="Documents de programme" data-rubrique="programmes">
            {current.data.programmes.length ? (
              current.data.programmes.map((programme) => (
                <ProgrammeView
                  key={programme.versions.at(-1)?.id}
                  candidat={candidat.id}
                  programme={programme}
                  themes={names}
                />
              ))
            ) : (
              <p className="presidentielle-manque">{NO_PROGRAMME_VERSIONS}</p>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
