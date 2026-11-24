// Sous-page Assistant : une question sur les programmes, une réponse faite uniquement de
// citations relues (texte exact, nature, source), groupées par candidat dans l'ordre
// tiré au sort pour la visite. Aucune recommandation de vote ; pendant un appel vocal,
// la recherche par le modèle attend la fin de l'appel (assistant.ts). Rien n'est
// conservé : seule la dernière réponse reste affichée tant que la page est ouverte.
import { Clock, MessageSquareQuote, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { store } from "@/state/store";

import {
  askBody,
  QUESTION_MAX,
  startAsk,
  WAITING_TEXT,
  type AskOutcome,
} from "./assistant";
import { EntreToursMark } from "./EntreToursMark";
import { themeLabel } from "./labels";
import { LoadState } from "./LoadState";
import { NatureTag } from "./NatureTag";
import { BaseVersion, Notices } from "./Notices";
import { Section } from "./Section";
import { SourceLink } from "./SourceLink";
import { presidentielleStore } from "./state";
import type { AskAnswer, AskPassage } from "./types";
import { usePresidentielle } from "./usePresidentielle";
import "./presidentielle.css";

type View = { status: "idle" } | { status: "pending" } | AskOutcome;

function Passage({ passage, theme }: { passage: AskPassage; theme: string }) {
  return (
    <li className="grid gap-1" data-passage={passage.id}>
      <blockquote className="presidentielle-citation">
        {passage.citation}
      </blockquote>
      <div className="presidentielle-meta">
        <Badge variant="outline" data-theme={passage.theme}>
          {theme}
        </Badge>
        <NatureTag nature={passage.nature} />
        <SourceLink source={passage.source} page={passage.page} />
        <EntreToursMark mesure={passage} />
      </div>
    </li>
  );
}

// Un bloc par candidat qui a un passage ou « pas de position », dans l'ordre reçu
function Answer({
  answer,
  themes,
}: {
  answer: AskAnswer;
  themes: Map<string, string>;
}) {
  const groups = answer.ordre
    .map((id) => ({
      id,
      passages: answer.passages.filter((p) => p.candidat === id),
      missing: answer.sans_position.find((s) => s.candidat === id),
    }))
    .filter((group) => group.passages.length || group.missing);
  return (
    <div
      className="grid gap-3"
      data-testid="presidentielle-reponse"
      data-kind={answer.kind}
    >
      {answer.kind === "refus" ? (
        <Alert role="note" data-testid="presidentielle-refus">
          <MessageSquareQuote aria-hidden />
          <AlertTitle>Pas de recommandation de vote</AlertTitle>
          <AlertDescription>{answer.introduction}</AlertDescription>
        </Alert>
      ) : (
        <p data-testid="presidentielle-introduction">{answer.introduction}</p>
      )}
      {groups.map((group) => (
        <Section
          key={group.id}
          title={group.passages[0]?.nom ?? group.missing?.nom ?? group.id}
          data-groupe={group.id}
        >
          {group.passages.length ? (
            <ul className="grid gap-3">
              {group.passages.map((passage) => (
                <Passage
                  key={passage.id}
                  passage={passage}
                  theme={themeLabel(passage, themes)}
                />
              ))}
            </ul>
          ) : (
            <p className="presidentielle-manque">{group.missing?.texte}</p>
          )}
        </Section>
      ))}
      {answer.model && (
        <p className="presidentielle-note" data-testid="presidentielle-modele">
          Passages choisis par le modèle {answer.model}, sans texte écrit par
          lui.
        </p>
      )}
    </div>
  );
}

export function AssistantPage() {
  const { status, error, base, meta } = usePresidentielle();
  const [question, setQuestion] = useState("");
  const [view, setView] = useState<View>({ status: "idle" });
  const cancel = useRef<(() => void) | null>(null);
  const inputId = useId();
  const helpId = useId();
  const themes = new Map(base?.themes.map((t) => [t.id, t.libelle]) ?? []);
  const trimmed = question.trim();
  const pending = view.status === "pending" || view.status === "waiting";

  // Quitter la page : minuterie et requête annulées
  useEffect(() => () => cancel.current?.(), []);

  const stop = () => {
    cancel.current?.();
    cancel.current = null;
    setView({ status: "idle" });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed) return;
    cancel.current?.();
    setView({ status: "pending" });
    cancel.current = startAsk({
      body: () =>
        askBody(
          trimmed,
          presidentielleStore.getState().order ?? [],
          store.getState().callState !== "idle",
        ),
      onUpdate: (outcome) => setView(outcome),
    });
  };

  return (
    <section aria-label="Assistant" className="presidentielle">
      <Notices base={base} meta={meta} />
      <LoadState status={status} error={error} loaded={base !== null} />
      <Section
        title="Interroger les programmes"
        data-testid="presidentielle-assistant"
      >
        <p className="presidentielle-note">
          Les réponses sont faites uniquement de citations relues des fiches
          publiées, avec leur source. L'assistant ne donne aucune recommandation
          de vote et n'écrit aucun avis. Vos questions ne sont pas conservées.
        </p>
        <form className="grid gap-2" onSubmit={submit}>
          <Label htmlFor={inputId}>Votre question</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id={inputId}
              className="min-w-0 flex-1"
              value={question}
              maxLength={QUESTION_MAX}
              aria-describedby={helpId}
              autoComplete="off"
              placeholder="Par exemple : que proposent-ils sur la santé ?"
              onChange={(event) => setQuestion(event.target.value)}
            />
            <Button type="submit" disabled={!trimmed || pending}>
              Poser la question
            </Button>
          </div>
          <p id={helpId} className="presidentielle-note">
            {question.length} / {QUESTION_MAX} caractères
          </p>
        </form>
      </Section>
      <div aria-live="polite" className="grid gap-3">
        {view.status === "pending" && (
          <p
            className="presidentielle-note"
            data-testid="presidentielle-attente"
          >
            Recherche dans les fiches…
          </p>
        )}
        {view.status === "waiting" && (
          <Alert role="status" data-testid="presidentielle-appel">
            <Clock aria-hidden />
            <AlertTitle>{WAITING_TEXT}</AlertTitle>
            <AlertDescription>
              <p>
                La recherche reprendra d'elle-même à la fin de l'appel vocal,
                pour ne pas le ralentir.
              </p>
              <Button variant="outline" size="sm" onClick={stop}>
                Annuler la question
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {view.status === "error" && (
          <Alert variant="destructive" role="alert">
            <TriangleAlert aria-hidden />
            <AlertTitle>Pas de réponse</AlertTitle>
            <AlertDescription>{view.message}</AlertDescription>
          </Alert>
        )}
        {view.status === "answer" && (
          <Answer answer={view.answer} themes={themes} />
        )}
      </div>
      {base && <BaseVersion version={base.version} />}
    </section>
  );
}
