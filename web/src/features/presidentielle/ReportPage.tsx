// Rapport du quiz, écran final de la sous-page Quiz : proximité par candidat (ordre tiré
// au sort, tri seulement à la demande), barres à deux pôles par thème (masquées tant que
// les axes ne sont pas gelés), détail de chaque réponse avec la mesure d'origine et sa
// source. Même gabarit pour tous les candidats, aucune recommandation de vote. Calculé
// dans le navigateur, sans appel réseau.
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

import { formatDate, NO_POSITION } from "./labels";
import { NatureTag } from "./NatureTag";
import { poleCounts, polesVisible, poleText } from "./poles";
import {
  counted,
  proximity,
  SANS_AVIS,
  scoreText,
  sortByProximity,
  SEUIL,
} from "./proximity";
import type { QuizSave } from "./quizStorage";
import { Section } from "./Section";
import { SourceLink } from "./SourceLink";
import type { Candidat, QuizData, QuizQuestion, QuizTheme } from "./types";

type Props = {
  quiz: QuizData;
  // Candidats du rapport, dans l'ordre tiré pour la visite
  candidats: Candidat[];
  save: QuizSave;
  onEdit: () => void;
  onClear: () => void;
  // Arrivée depuis un bouton : le focus va au titre du rapport
  focus?: boolean;
};

function Proximity({
  quiz,
  candidats,
  save,
}: Pick<Props, "quiz" | "candidats" | "save">) {
  const [sorted, setSorted] = useState(false);
  const scores = proximity(
    save.ordre_questions,
    save.reponses,
    quiz.rattachements,
    candidats.map((c) => c.id),
  );
  const drawn = candidats.map((c) => c.id);
  const ids = sorted ? sortByProximity(drawn, scores) : drawn;
  const byId = new Map(candidats.map((c) => [c.id, c]));
  return (
    <Section title="Proximité avec les positions des candidats">
      <p className="presidentielle-note">
        Part des questions où votre réponse est la même option que la position
        connue du candidat, parmi les questions où il en a une. « Sans avis » et
        les questions sans réponse ne comptent pas ; « aucune de ces
        propositions » compte comme une différence. Pourcentage affiché à partir
        de {SEUIL} questions. Ce rapport n'est pas une recommandation de vote.
      </p>
      <div>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={sorted}
          onClick={() => setSorted((value) => !value)}
        >
          Trier par proximité
        </Button>
      </div>
      <ul className="grid gap-3" aria-label="Proximité par candidat">
        {ids.map((id) => {
          const candidat = byId.get(id) as Candidat;
          const result = scores.get(id);
          if (!result) return null;
          const text = scoreText(result);
          return (
            <li
              key={id}
              className="grid gap-1"
              data-testid="presidentielle-proximite"
              data-candidat={id}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{candidat.nom_affiche}</span>
                <span className="presidentielle-note" data-score>
                  {text}
                </span>
              </div>
              {!result.insuffisant && (
                <Progress
                  className="h-2"
                  value={result.pourcent}
                  aria-valuenow={result.pourcent}
                  aria-valuetext={text}
                  aria-label={`${candidat.nom_affiche} : ${text}`}
                />
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Poles({ quiz, save }: Pick<Props, "quiz" | "save">) {
  if (!polesVisible(quiz))
    return (
      <Section title="Barres à deux pôles" data-testid="presidentielle-poles">
        <p className="presidentielle-manque" data-poles="masquees">
          Barres masquées : la grille des axes n'est pas encore gelée.
        </p>
      </Section>
    );
  const counts = poleCounts(quiz.themes, save.ordre_questions, save.reponses);
  return (
    <Section title="Barres à deux pôles" data-testid="presidentielle-poles">
      <p className="presidentielle-note">
        Pour chaque thème, vos réponses placées sur l'axe défini par écrit dans
        la grille. La partie colorée de la barre est la part de vos réponses
        vers le premier pôle nommé, affiché avant la barre ; une réponse « mixte
        » compte pour moitié de chaque côté. « Sans avis » et « aucune de ces
        propositions » ne comptent dans aucun pôle.
      </p>
      <ul className="grid gap-4" aria-label="Barres à deux pôles par thème">
        {counts.map((count) => {
          const text = poleText(count);
          return (
            <li
              key={count.theme.id}
              className="grid gap-1"
              data-testid="presidentielle-pole"
              data-theme={count.theme.id}
            >
              <span className="font-medium">{count.theme.libelle}</span>
              <div className="presidentielle-axe">
                <span className="presidentielle-axe__pole">
                  {count.theme.axe.pole_a}
                </span>
                {count.valeur === null ? (
                  <span className="presidentielle-manque text-center">
                    aucune réponse placée
                  </span>
                ) : (
                  <Progress
                    className="h-2"
                    value={count.valeur}
                    aria-valuenow={count.valeur}
                    aria-valuetext={text}
                    aria-label={`${count.theme.libelle} : ${text}`}
                  />
                )}
                <span className="presidentielle-axe__pole">
                  {count.theme.axe.pole_b}
                </span>
              </div>
              <p className="presidentielle-note" data-decompte>
                {text}
              </p>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Detail({
  quiz,
  candidats,
  save,
}: Pick<Props, "quiz" | "candidats" | "save">) {
  const questions = new Map<string, [QuizTheme, QuizQuestion]>(
    quiz.themes.flatMap((t) =>
      t.questions.map(
        (q) => [q.id, [t, q]] as [string, [QuizTheme, QuizQuestion]],
      ),
    ),
  );
  return (
    <Section
      title="Détail de vos réponses"
      data-testid="presidentielle-detail-quiz"
    >
      <ol className="grid gap-4">
        {save.ordre_questions.map((id) => {
          const found = questions.get(id);
          if (!found) return null;
          const [theme, question] = found;
          const answer = save.reponses[id];
          const chosen = question.options.find((o) => o.id === answer);
          const compared = chosen !== undefined && answer !== SANS_AVIS;
          return (
            <li key={id} className="grid gap-2" data-question={id}>
              <div className="presidentielle-meta">
                <Badge variant="outline">{theme.libelle}</Badge>
                <span className="font-medium">{question.enonce}</span>
              </div>
              <p>
                Votre réponse :{" "}
                <strong data-reponse>
                  {chosen ? chosen.libelle : "sans réponse (comptée sans avis)"}
                </strong>
              </p>
              <ul className="presidentielle-liste">
                {candidats.map((candidat) => {
                  const link = quiz.rattachements.find(
                    (r) => r.question === id && r.candidat === candidat.id,
                  );
                  const option = link
                    ? question.options.find((o) => o.id === link.option)
                    : undefined;
                  const mesure = link
                    ? candidat.mesures.find((m) => m.id === link.mesure_id)
                    : undefined;
                  return (
                    <li
                      key={candidat.id}
                      className="grid gap-1"
                      data-candidat={candidat.id}
                    >
                      <span>
                        <span className="font-medium">
                          {candidat.nom_affiche}
                        </span>{" "}
                        : {option ? option.libelle : NO_POSITION}
                        {option && compared && (
                          <span className="presidentielle-note">
                            {" "}
                            (
                            {option.id === answer
                              ? "même option"
                              : "autre option"}
                            )
                          </span>
                        )}
                      </span>
                      {mesure && (
                        <>
                          <blockquote className="presidentielle-citation">
                            {mesure.citation}
                          </blockquote>
                          <div className="presidentielle-meta">
                            <NatureTag nature={mesure.nature} />
                            <SourceLink
                              source={mesure.source}
                              page={mesure.page}
                            />
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

export function ReportPage({
  quiz,
  candidats,
  save,
  onEdit,
  onClear,
  focus = false,
}: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) heading.current?.focus();
  }, [focus]);
  const total = save.ordre_questions.length;
  const answered = counted(save.ordre_questions, save.reponses).length;
  return (
    <div className="grid gap-4" data-testid="presidentielle-rapport">
      <h2
        ref={heading}
        tabIndex={-1}
        className="text-lg font-medium outline-none"
      >
        Rapport du quiz
      </h2>
      <p className="presidentielle-note" data-resume>
        Questions comptées : {answered} sur {total} (« sans avis » et questions
        sans réponse écartées).
        {save.termine_le
          ? ` Quiz terminé le ${formatDate(save.termine_le)}.`
          : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onEdit}>
          Modifier mes réponses
        </Button>
        <Button variant="outline" onClick={onClear}>
          Effacer
        </Button>
      </div>
      <Proximity quiz={quiz} candidats={candidats} save={save} />
      <Poles quiz={quiz} save={save} />
      <Detail quiz={quiz} candidats={candidats} save={save} />
    </div>
  );
}
