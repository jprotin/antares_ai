// Logique pure de la Répétition (port de rehearsal.js) : repères du routeur, phases,
// libellés, horloges, analyse des transcriptions, notes révisées.

// Repères reconnus par le routeur (router/rehearsal.py : QA_MARKER, REPORT_MARKER)
export const QA_MARKER = "[Fin du discours]";
export const reportMarker = (index: number) => `[Rapport, partie ${index}]`;
// Fin de discours : dernière phrase encore en cours de transcription
export const TRANSCRIPT_WAIT_MS = 4000;
// Mesure du bruit de la pièce, micro ouvert et sans parler
export const CALIBRATION_MS = 3000;
// Bribe écartée de l'analyse (souvent un bruit transcrit en « Merci. » ou « Hum ») :
// au plus 2 mots en moins d'une seconde
export const FRAGMENT_WORDS = 2;
export const FRAGMENT_SECONDS = 1;

export type Phase = "speech" | "qa" | "analysis" | "report";

export const NEXT_LABEL: Record<Phase, string> = {
  speech: "J'ai terminé mon discours",
  qa: "Voir le rapport",
  analysis: "Analyse en cours…",
  report: "Terminer",
};

export const STEPS = [
  { step: "speech", label: "Discours" },
  { step: "qa", label: "Questions" },
  { step: "report", label: "Rapport" },
] as const;

// Étapes faites et courante (l'analyse compte comme le rapport)
export function stepStates(phase: Phase): ("done" | "current" | "todo")[] {
  const order = STEPS.map((s) => s.step as Phase);
  const reached = order.indexOf(phase === "analysis" ? "report" : phase);
  return order.map((_, index) =>
    index < reached ? "done" : index === reached ? "current" : "todo",
  );
}

// Visionneuse masquée pendant l'analyse et le rapport
export const slidesHidden = (phase: Phase) =>
  phase === "report" || phase === "analysis";

export type PluginState = {
  phase: Phase;
  reading: boolean;
  talking: boolean;
} | null;

// Le panneau affiche lui-même la parole (pas de sous-titres dans la conversation)
export const isActive = (s: PluginState) =>
  (Boolean(s) && s?.phase !== "report") ||
  Boolean(s?.reading) ||
  Boolean(s?.talking);

// Fin de parole sans réflexion attendue
export const isSilent = (s: PluginState) =>
  s?.phase === "speech" || s?.phase === "analysis";

// Micro coupé tant que l'avatar parle (questions, rapport, discussion)
export const holdsMic = (s: PluginState) => Boolean(s) && s?.phase !== "speech";

export function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function longClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return minutes
    ? `${minutes} min ${String(total % 60).padStart(2, "0")} s`
    : `${total} s`;
}

export const wordCount = (text: string) =>
  text.split(/\s+/).filter(Boolean).length;

export function formatDate(
  seconds: number,
  timeStyle: "short" | "medium" = "short",
) {
  return new Date(seconds * 1000).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle,
  });
}

type Revisable = {
  score?: number;
  initial_score?: number | null;
  revisions?: { criterion: string; before: number }[];
};

// Note de départ de chaque critère révisé
export function initialScores(report: Revisable): Record<string, number> {
  const initial: Record<string, number> = {};
  for (const change of report.revisions ?? []) {
    if (!(change.criterion in initial))
      initial[change.criterion] = change.before;
  }
  return initial;
}

export const revised = (report: Revisable) =>
  report.initial_score !== undefined &&
  report.initial_score !== null &&
  report.initial_score !== report.score;

// Sans réponse de l'IA, le moteur rouvre le même tour de parole (pause de moins de
// 7 s) : chaque transcription reprend tout ce qui a été dit depuis le début du tour.
// Renvoie la seule partie nouvelle ; un tour neuf ne commence pas par les mêmes mots.
const OPENING_WORDS = 4;
// Mot comparé sans casse ni ponctuation (« tous. » puis « tous, » d'une fois à l'autre)
export const plainWord = (word: string) =>
  word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
// Mots d'une transcription, sans ponctuation isolée (« tous ! Alors »)
export const tokens = (text: string) =>
  text.split(/\s+/).filter((word) => plainWord(word));

export function newPart(previous: string, text: string): string {
  if (!previous) return text;
  if (text.startsWith(previous)) return text.slice(previous.length).trim();
  const before = tokens(previous);
  const words = tokens(text);
  const sameTurn = before
    .slice(0, OPENING_WORDS)
    .every((word, index) => plainWord(word) === plainWord(words[index] ?? ""));
  if (!sameTurn) return text;
  // Début retranscrit autrement : on garde les mots en plus
  return words.slice(before.length).join(" ");
}

// Bribe isolée pendant le discours ou les questions : écartée de l'analyse
export function isFragment(
  text: string,
  spokenSeconds: number,
  phase: Phase,
): boolean {
  return (
    wordCount(text) <= FRAGMENT_WORDS &&
    spokenSeconds < FRAGMENT_SECONDS &&
    (phase === "speech" || phase === "qa")
  );
}

// Niveau du micro affiché sur une échelle de -60 à 0 dB
export const meterPosition = (rms: number) =>
  Math.min(1, Math.max(0, (20 * Math.log10(rms || 1e-6) + 60) / 60));
