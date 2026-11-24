// Sous-page Méthode : règles de neutralité, niveaux de source, règle de calcul du quiz
// et ses quatre exemples (ceux de la spec, tels quels), thèmes des fiches (dont ceux
// hors quiz), axes des thèmes, journal des
// modifications (du plus récent au plus ancien), évolution des fiches et des programmes,
// version de la base.
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { formatDate, NIVEAU_LABEL, NO_GRID, PAGE_TITLE } from "./labels";
import { LoadState } from "./LoadState";
import { BaseVersion, Notices } from "./Notices";
import { Section } from "./Section";
import { usePresidentielle } from "./usePresidentielle";
import type { BasePubliee, EntreeJournal } from "./types";
import "./presidentielle.css";

const RULES = [
  "Trois niveaux de source, affichés sur chaque citation : « officiel État », « document du candidat », « vote réel ». Sondages, projections et presse sont exclus.",
  "Les jeux de données associatifs servent seulement à repérer des documents ; chaque élément est revérifié sur la source primaire, jamais cité.",
  "Deux natures de texte, signalées : « du candidat » (citations exactes) et « de la rédaction » (description, résumés, reformulations du quiz).",
  "Même gabarit pour tous : mêmes thèmes, cinq lignes phares au plus, tirées des priorités annoncées par le candidat ; les manques sont affichés. L'ordre des candidats est tiré au sort à chaque visite.",
  "« Pas de position connue » n'est pas « contre » : un silence ne compte jamais.",
  "Méthode publique : la règle de calcul est affichée ici, avec des exemples chiffrés.",
  "Aucune recommandation de vote, ni dans les écrans ni dans les réponses.",
  "Entre les deux tours, seuls les deux candidats qualifiés sont présentés ; une question du quiz compte dès que l'un des deux y a une position. Après le second tour, la base est figée : plus rien n'est publié, sauf une correction inscrite au journal.",
];

const LEVELS = [
  {
    niveau: NIVEAU_LABEL.officiel_etat,
    sources:
      "Liste officielle et parrainages du Conseil constitutionnel, professions de foi du ministère de l'Intérieur, résultats officiels de 2022 (contexte seulement).",
  },
  {
    niveau: NIVEAU_LABEL.candidat,
    sources: "Programme et site officiel du candidat.",
  },
  {
    niveau: NIVEAU_LABEL.vote_reel,
    sources:
      "Données ouvertes de l'Assemblée nationale, du Sénat et du Parlement européen ; hors du calcul du quiz.",
  },
];

const CALCULATION = [
  "Chaque question propose 3 à 5 options qui s'excluent, plus « aucune de ces propositions » et « sans avis ». Un candidat est rattaché à une option au plus, par une mesure citée ; sinon il est « pas de position connue ». Pas d'accord partiel.",
  "Score d'un candidat = accords ÷ questions répondues où il a une position connue. « Sans avis » est exclu pour tous. « Aucune de ces propositions » compte comme un désaccord avec chaque candidat qui a une position.",
  "Seuil : un pourcentage n'est affiché que s'il repose sur au moins 10 questions (la moitié de la grille). En dessous : « données insuffisantes (n questions) ».",
  "Poids : 10 thèmes, 2 questions chacun, donc tous les thèmes pèsent autant.",
  "Les votes réels n'entrent pas dans le calcul, sinon les candidats sans mandat seraient désavantagés.",
  "Barres à deux pôles, par thème : chaque option est placée vers un pôle de l'axe ou « mixte ». La partie colorée de la barre est la part de vos réponses vers le premier pôle de l'axe (affiché à gauche), une réponse « mixte » comptant pour moitié de chaque côté ; « sans avis » et « aucune de ces propositions » ne comptent dans aucun pôle. Les barres à deux pôles n'entrent pas dans le calcul de la proximité.",
];

const EXAMPLES = [
  {
    situation:
      "18 réponses (2 « sans avis ») ; A a une position sur 15, 9 accords",
    resultat: "A : 60 %, « sur 15 questions »",
  },
  {
    situation: "B a une position sur 6 questions répondues, 6 accords",
    resultat: "B : « données insuffisantes (6 questions) », pas 100 %",
  },
  {
    situation:
      "« Aucune de ces propositions » ; A et C ont une position, B non",
    resultat: "Désaccord pour A et C ; B inchangé",
  },
  {
    situation: "« Sans avis » sur une question",
    resultat: "Question retirée du calcul de tous les candidats",
  },
];

const EVOLUTION = [
  "Chaque version publiée d'une fiche est gardée telle quelle. L'onglet « Évolution » de chaque fiche liste les versions, de la plus récente à la plus ancienne : date, motif inscrit au journal, mesures ajoutées, retirées ou reformulées (avec leur citation et leur source), nouvelles sources et changement de statut.",
  "Quand un candidat publie une nouvelle version de son programme, elle est inscrite comme remplaçant la précédente. Chaque version garde sa date de publication, sa date de consultation et son empreinte.",
  "Deux versions d'un même programme se comparent mot pour mot, paragraphe par paragraphe (ajouté, retiré, modifié), avec la page de chaque côté. Pour chaque citation de la fiche sont indiquées la première version qui la contient et, s'il y a lieu, la première qui ne la contient plus (recherche mot pour mot, apostrophes, guillemets et espaces unifiés).",
  "Seul le texte des fiches et des documents est affiché : ni résumé, ni appréciation du changement.",
  "Une mesure retirée parce qu'elle avait été saisie par erreur (citation inexacte, attribuée à tort ou sortie de son contexte) n'est plus montrée dans aucune version : seule la date du retrait est indiquée, sans citation ni source.",
  "Limite : les versions publiées avant la première copie conservée ne sont pas récupérables.",
];

const OBJET_LABEL: Record<string, string> = {
  fiche: "Fiche",
  rattachement: "Rattachements du quiz",
  gel_grille: "Gel de la grille",
  correction_grille: "Correction de la grille",
  base: "Base",
};

const THEMES_NOTE =
  "Les mesures de chaque fiche sont classées par thème, dans le même ordre pour tous. Les thèmes du quiz ont chacun deux questions et un axe. Les thèmes marqués « hors quiz » ci-dessous figurent sur les fiches, dans l'assistant et dans l'évolution, mais pas dans le quiz : aucune question, aucun axe, aucune place dans le rapport, pour que les dix thèmes du quiz gardent le même poids.";

function Themes({ base }: { base: BasePubliee }) {
  return (
    <Section data-methode="themes" title="Thèmes des fiches">
      <p className="presidentielle-note">{THEMES_NOTE}</p>
      {base.themes.length > 0 && (
        <ul className="presidentielle-liste list-disc">
          {base.themes.map((theme) => (
            <li
              key={theme.id}
              data-theme-methode={theme.id}
              data-hors-quiz={theme.hors_quiz ? "" : undefined}
            >
              {theme.libelle}
              {theme.hors_quiz && (
                <>
                  {" "}
                  <Badge variant="outline">hors quiz</Badge>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Axes({ base }: { base: BasePubliee }) {
  const frozen = base.axes_statut === "gelee";
  // Thèmes déduits des mesures (grille absente) et thèmes hors quiz : sans axe, non
  // listés ici
  const axes = base.themes.flatMap((theme) =>
    theme.axe ? [{ theme, axe: theme.axe }] : [],
  );
  return (
    <Section data-methode="axes" title="Axes des thèmes">
      <p className="presidentielle-note">
        {frozen ? (
          "Grille des axes validée et gelée : un axe par thème, avec ses deux pôles définis par écrit."
        ) : (
          <>
            <Badge variant="outline">en préparation</Badge> La grille des axes
            n'est pas encore gelée ; les barres du quiz restent masquées
            jusque-là.
          </>
        )}
      </p>
      {axes.length ? (
        <ul className="grid gap-2">
          {axes.map(({ theme, axe }) => (
            <li key={theme.id} data-axe={theme.id}>
              <strong>{theme.libelle}</strong> : {axe.pole_a} / {axe.pole_b}
            </li>
          ))}
        </ul>
      ) : (
        <p
          className="presidentielle-manque"
          data-testid="presidentielle-sans-axes"
        >
          {NO_GRID}
        </p>
      )}
    </Section>
  );
}

function Journal({ base }: { base: BasePubliee }) {
  const names = new Map(base.candidats.map((c) => [c.id, c.nom_affiche]));
  // Du plus récent au plus ancien (tri stable : l'ordre du routeur départage)
  const entries: EntreeJournal[] = [...base.journal].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  return (
    <Section data-methode="journal" title="Journal des modifications">
      {entries.length ? (
        <ol className="grid gap-2" data-testid="presidentielle-journal">
          {entries.map((entry, index) => (
            <li key={index} data-date={entry.date}>
              <span className="text-muted-foreground">
                {formatDate(entry.date)}
              </span>{" "}
              — {OBJET_LABEL[entry.objet] ?? entry.objet}
              {entry.cible ? ` : ${names.get(entry.cible) ?? entry.cible}` : ""}
              {entry.version ? ` (version ${entry.version})` : ""}.{" "}
              {entry.motif}
            </li>
          ))}
        </ol>
      ) : (
        <p className="presidentielle-manque">Aucune modification enregistrée</p>
      )}
    </Section>
  );
}

export function MethodPage() {
  const { status, error, base, meta } = usePresidentielle();
  return (
    <section aria-label="Méthode" className="presidentielle">
      <Notices base={base} meta={meta} />
      <LoadState status={status} error={error} loaded={base !== null} />
      <article className="grid gap-4" data-testid="presidentielle-methode">
        <h2 className="text-xl font-semibold">Méthode de {PAGE_TITLE}</h2>
        <Section data-methode="regles" title="Règles de neutralité">
          <ol className="presidentielle-liste list-decimal">
            {RULES.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ol>
        </Section>
        <Section data-methode="niveaux" title="Niveaux de source">
          <ul className="presidentielle-liste list-disc">
            {LEVELS.map(({ niveau, sources }) => (
              <li key={niveau}>
                <strong>{niveau}</strong> : {sources}
              </li>
            ))}
            <li>
              <strong>Exclus</strong> : sondages, projections et presse.
            </li>
          </ul>
        </Section>
        <Section data-methode="calcul" title="Règle de calcul du quiz">
          <ul className="presidentielle-liste list-disc">
            {CALCULATION.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <Table data-testid="presidentielle-exemples">
            <TableCaption>Exemples chiffrés</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Exemple</TableHead>
                <TableHead scope="col">Situation</TableHead>
                <TableHead scope="col">Résultat attendu</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {EXAMPLES.map((example, index) => (
                <TableRow key={index} data-exemple={index + 1}>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell className="whitespace-normal">
                    {example.situation}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {example.resultat}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
        <Section
          data-methode="evolution"
          title="Évolution des fiches et des programmes"
        >
          <ul className="presidentielle-liste list-disc">
            {EVOLUTION.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Section>
        {base && <Themes base={base} />}
        {base && <Axes base={base} />}
        {base && <Journal base={base} />}
        {base && <BaseVersion version={base.version} />}
      </article>
    </section>
  );
}
