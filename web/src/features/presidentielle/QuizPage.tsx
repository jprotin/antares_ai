// Sous-page Quiz : questions éligibles (validées et assez couvertes) dans un ordre tiré au
// sort, options mélangées (« aucune de ces propositions » et « sans avis » en dernier),
// retour en arrière possible, puis rapport (ReportPage). La grille est lue une fois à
// l'ouverture ; ensuite, aucun appel réseau : les réponses restent dans ce navigateur
// (quizStorage.ts) et « Effacer » les supprime.
import { History, Info, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";

import { loadQuiz } from "./api";
import { LoadState } from "./LoadState";
import { BaseVersion, Notices } from "./Notices";
import { reportCandidates } from "./proximity";
import {
  clearSave,
  newSave,
  quizQuestions,
  readSave,
  resumeSave,
  writeSave,
  type QuizSave,
  type ResumeNotice,
} from "./quizStorage";
import { ReportPage } from "./ReportPage";
import { inVisitOrder } from "./state";
import type { QuizData, QuizQuestion, QuizTheme } from "./types";
import { usePresidentielle } from "./usePresidentielle";
import "./presidentielle.css";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; quiz: QuizData };

// Date locale du navigateur (AAAA-MM-JJ)
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function QuestionCard({
  question,
  theme,
  position,
  total,
  order,
  answer,
  onAnswer,
  onPrevious,
  onNext,
  focus,
}: {
  question: QuizQuestion;
  theme: QuizTheme | undefined;
  position: number;
  total: number;
  order: string[];
  answer: string | undefined;
  onAnswer: (option: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  focus: boolean;
}) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const options = order
    .map((id) => question.options.find((o) => o.id === id))
    .filter((o) => o !== undefined);
  const last = position === total;

  // Question suivante ou précédente : le focus va à l'énoncé (lecteurs d'écran, clavier)
  useEffect(() => {
    if (focus) heading.current?.focus();
  }, [question.id, focus]);

  return (
    <Card data-testid="presidentielle-quiz" data-question={question.id}>
      <CardHeader className="grid gap-2">
        <div className="presidentielle-meta">
          <span className="presidentielle-note" data-position>
            Question {position} sur {total}
          </span>
          {theme && <Badge variant="outline">{theme.libelle}</Badge>}
        </div>
        <Progress
          value={(100 * position) / total}
          aria-label={`Avancement : question ${position} sur ${total}`}
        />
      </CardHeader>
      <CardContent>
        <div
          key={question.id}
          className="grid gap-3 animate-in duration-300 fade-in-0 slide-in-from-right-4 motion-reduce:animate-none"
          data-testid="presidentielle-question"
        >
          <h3
            id={titleId}
            ref={heading}
            tabIndex={-1}
            className="text-base font-medium outline-none"
          >
            {question.enonce}
          </h3>
          <RadioGroup
            aria-labelledby={titleId}
            value={answer ?? ""}
            onValueChange={onAnswer}
          >
            {options.map((option) => {
              const id = `${titleId}-${option.id}`;
              return (
                <div
                  key={option.id}
                  className="flex items-center gap-3 rounded-md border px-3 py-2"
                  data-option={option.id}
                >
                  <RadioGroupItem id={id} value={option.id} />
                  <Label htmlFor={id} className="flex-1 font-normal">
                    {option.libelle}
                  </Label>
                </div>
              );
            })}
          </RadioGroup>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap justify-between gap-2 pb-4">
        <Button
          variant="outline"
          onClick={onPrevious}
          disabled={position === 1}
        >
          Précédent
        </Button>
        <Button onClick={onNext}>{last ? "Voir le rapport" : "Suivant"}</Button>
      </CardFooter>
    </Card>
  );
}

export function QuizPage() {
  const { status, error, base, meta, order } = usePresidentielle();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [save, setSave] = useState<QuizSave | null>(null);
  const [notice, setNotice] = useState<ResumeNotice>(null);
  const [stored, setStored] = useState(true);
  const [index, setIndex] = useState(0);
  const [view, setView] = useState<"questions" | "rapport">("questions");
  const [moved, setMoved] = useState(false);

  // Grille lue une fois ; quiz conservé repris (ordres, réponses), sinon nouveau tirage
  useEffect(() => {
    let alive = true;
    loadQuiz()
      .then((quiz) => {
        if (!alive) return;
        const saved = readSave();
        const resumed = resumeSave(saved, quiz);
        setLoad({ status: "ready", quiz });
        setSave(resumed.save);
        setNotice(resumed.notice);
        if (saved) setStored(writeSave(resumed.save));
        const first = resumed.save.ordre_questions.findIndex(
          (id) => resumed.save.reponses[id] === undefined,
        );
        setIndex(Math.max(first, 0));
        setView(resumed.save.termine_le ? "rapport" : "questions");
      })
      .catch((reason: unknown) => {
        if (alive)
          setLoad({
            status: "error",
            message: reason instanceof Error ? reason.message : String(reason),
          });
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  const persist = (next: QuizSave) => {
    setSave(next);
    setStored(writeSave(next));
  };

  const quiz = load.status === "ready" ? load.quiz : null;
  const questions = quiz ? quizQuestions(quiz) : [];
  const byId = new Map(questions.map((q) => [q.id, q]));
  const themeOf = new Map(
    quiz?.themes.flatMap((t) => t.questions.map((q) => [q.id, t])) ?? [],
  );
  const ids = save?.ordre_questions.filter((id) => byId.has(id)) ?? [];
  const currentId = ids[Math.min(index, ids.length - 1)];
  const current = currentId ? byId.get(currentId) : undefined;
  const candidats =
    base && quiz
      ? reportCandidates(inVisitOrder(base.candidats, order), quiz.participants)
      : [];

  const clear = () => {
    if (!quiz) return;
    // Clé supprimée ; nouveau tirage, écrit seulement à la première réponse
    setStored(clearSave());
    setSave(newSave(quiz));
    setNotice(null);
    setIndex(0);
    setMoved(true);
    setView("questions");
  };

  const recalculate = () => {
    if (!quiz || !save) return;
    persist({ ...save, base_version: quiz.version });
    setNotice(null);
  };

  const next = () => {
    if (!save) return;
    setMoved(true);
    if (index < ids.length - 1) {
      setIndex(index + 1);
      return;
    }
    persist({ ...save, termine_le: today() });
    setView("rapport");
  };

  const unavailable =
    quiz && (!quiz.disponible || !quiz.grille_version || !ids.length);

  return (
    <section aria-label="Quiz" className="presidentielle">
      <Notices base={base} meta={meta} />
      <LoadState status={status} error={error} loaded={base !== null} />
      <p
        className="presidentielle-note"
        data-testid="presidentielle-quiz-intro"
      >
        Les questions reformulent des mesures, sans nom de candidat ni de parti.
        Vos réponses restent dans ce navigateur : aucune n'est envoyée au
        serveur. Le rapport compare vos réponses aux positions citées dans les
        fiches ; il ne donne aucune recommandation de vote.
      </p>
      {load.status === "loading" && (
        <Skeleton
          className="h-72 w-full"
          role="status"
          aria-label="Chargement du quiz"
        />
      )}
      {load.status === "error" && (
        <Alert variant="destructive" role="alert">
          <TriangleAlert aria-hidden />
          <AlertTitle>Quiz illisible</AlertTitle>
          <AlertDescription>
            <p>La grille du quiz n'a pas pu être lue : {load.message}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoad({ status: "loading" });
                setAttempt((n) => n + 1);
              }}
            >
              Réessayer
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {!stored && (
        <Alert role="note" data-notice="stockage">
          <Info aria-hidden />
          <AlertTitle>Réponses non conservées</AlertTitle>
          <AlertDescription>
            Le stockage de ce navigateur est indisponible : vos réponses restent
            en mémoire le temps de la page.
          </AlertDescription>
        </Alert>
      )}
      {notice === "grille" && (
        <Alert role="note" data-notice="grille">
          <History aria-hidden />
          <AlertTitle>Grille du quiz modifiée</AlertTitle>
          <AlertDescription>
            La grille a changé depuis votre dernier quiz : vos anciennes
            réponses ont été écartées.
          </AlertDescription>
        </Alert>
      )}
      {notice === "base" && (
        <Alert role="note" data-notice="base">
          <History aria-hidden />
          <AlertTitle>Base modifiée depuis votre quiz, recalculer</AlertTitle>
          <AlertDescription>
            <p>
              Des fiches ont changé depuis vos réponses. Vos réponses sont
              gardées ; le rapport sera calculé avec la base actuelle.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={recalculate}>
                Recalculer
              </Button>
              <Button variant="ghost" size="sm" onClick={clear}>
                Effacer
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {unavailable && (
        <Alert role="note" data-notice="quiz-indisponible">
          <Info aria-hidden />
          <AlertTitle>Quiz indisponible</AlertTitle>
          <AlertDescription>
            {quiz.message ??
              "Aucune question n'est encore assez couverte par les fiches publiées."}
          </AlertDescription>
        </Alert>
      )}
      {quiz && save && !unavailable && view === "questions" && current && (
        <>
          <h2 className="sr-only">Questions du quiz</h2>
          <QuestionCard
            question={current}
            theme={themeOf.get(current.id)}
            position={Math.min(index, ids.length - 1) + 1}
            total={ids.length}
            order={save.ordre_options[current.id] ?? []}
            answer={save.reponses[current.id]}
            onAnswer={(option) =>
              persist({
                ...save,
                reponses: { ...save.reponses, [current.id]: option },
              })
            }
            onPrevious={() => {
              setMoved(true);
              setIndex(Math.max(index - 1, 0));
            }}
            onNext={next}
            focus={moved}
          />
          <div className="flex flex-wrap gap-2">
            {save.termine_le && (
              <Button
                variant="outline"
                onClick={() => {
                  setMoved(true);
                  setView("rapport");
                }}
              >
                Revenir au rapport
              </Button>
            )}
            <Button variant="ghost" onClick={clear}>
              Effacer
            </Button>
          </div>
        </>
      )}
      {quiz &&
        save &&
        !unavailable &&
        view === "rapport" &&
        notice !== "base" &&
        base && (
          <ReportPage
            quiz={quiz}
            candidats={candidats}
            save={save}
            onEdit={() => {
              setIndex(0);
              setMoved(true);
              setView("questions");
            }}
            onClear={clear}
            focus={moved}
          />
        )}
      {quiz && save && !unavailable && view === "rapport" && !base && (
        <Alert role="note" data-notice="rapport-indisponible">
          <Info aria-hidden />
          <AlertTitle>Rapport indisponible</AlertTitle>
          <AlertDescription>
            <p>
              Les fiches n'ont pas pu être lues : le rapport s'affichera quand
              elles le seront. Vos réponses sont gardées.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIndex(0);
                  setMoved(true);
                  setView("questions");
                }}
              >
                Modifier mes réponses
              </Button>
              <Button variant="ghost" size="sm" onClick={clear}>
                Effacer
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {base && <BaseVersion version={base.version} />}
    </section>
  );
}
