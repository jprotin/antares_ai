// Assistant de la page (lot 2) : envoi de la question au routeur et mise en attente
// pendant un appel vocal. La question part toujours, avec la mention « appel en cours »
// si un appel est actif dans ce navigateur ; seul un 409 (recherche par le modèle
// pendant un appel) la met en attente : elle est renvoyée seule toutes les 30 s jusqu'à
// la réponse. Quitter la page annule l'attente et la requête. Rien n'est conservé.
import { detailMessage, WRITE_HEADERS } from "@/lib/api";

import type { AskAnswer, AskBody } from "./types";

export const QUESTION_MAX = 500;
export const RETRY_MS = 30_000;
export const WAITING_TEXT = "Appel en cours : réponse après l'appel";

export type AskOutcome =
  | { status: "answer"; answer: AskAnswer }
  | { status: "waiting" }
  | { status: "error"; message: string };

export function askBody(
  question: string,
  ordre: readonly string[],
  callActive: boolean,
): AskBody {
  return {
    question: question.trim(),
    ordre: [...ordre],
    appel_en_cours: callActive,
  };
}

function checkedAnswer(value: unknown): AskAnswer | null {
  const answer = value as AskAnswer | null;
  if (
    !answer ||
    typeof answer.introduction !== "string" ||
    !Array.isArray(answer.passages) ||
    !Array.isArray(answer.sans_position) ||
    !Array.isArray(answer.ordre)
  )
    return null;
  return answer;
}

export async function postAsk(
  body: AskBody,
  signal?: AbortSignal,
): Promise<AskOutcome> {
  let response: Response;
  try {
    response = await fetch("api/presidentielle/ask", {
      method: "POST",
      headers: { ...WRITE_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: "error", message: "le serveur est injoignable" };
  }
  const data = (await response.json().catch(() => null)) as {
    detail?: unknown;
  } | null;
  if (response.status === 409) return { status: "waiting" };
  if (!response.ok)
    return {
      status: "error",
      message: detailMessage(data?.detail) ?? `erreur HTTP ${response.status}`,
    };
  const answer = checkedAnswer(data);
  return answer
    ? { status: "answer", answer }
    : { status: "error", message: "réponse du routeur illisible" };
}

export type AskLoop = {
  // Corps relu à chaque envoi (la mention d'appel suit l'état courant)
  body: () => AskBody;
  onUpdate: (outcome: AskOutcome) => void;
  send?: (body: AskBody, signal: AbortSignal) => Promise<AskOutcome>;
  retryMs?: number;
};

// Envoie la question, puis la renvoie seule tant que le routeur répond « attente » ;
// renvoie la fonction d'annulation (minuterie et requête en cours)
export function startAsk({
  body,
  onUpdate,
  send = postAsk,
  retryMs = RETRY_MS,
}: AskLoop): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;

  const attempt = async () => {
    timer = undefined;
    let outcome: AskOutcome;
    try {
      outcome = await send(body(), controller.signal);
    } catch {
      if (cancelled) return;
      outcome = { status: "error", message: "le serveur est injoignable" };
    }
    if (cancelled) return;
    onUpdate(outcome);
    if (outcome.status === "waiting") timer = setTimeout(attempt, retryMs);
  };
  void attempt();

  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  };
}
