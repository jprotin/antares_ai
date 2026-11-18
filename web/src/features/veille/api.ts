// Appels de la veille : votes (articles, idées), prompt d'une idée, sources, articles
// non retenus, passage manuel. Erreurs avec
// leur statut HTTP (0 : serveur injoignable) pour proposer « Réessayer » à bon escient.
import { detailMessage } from "@/lib/api";
import type {
  VeilleCustomSource,
  VeilleFavorites,
  VeilleIdeaPrompt,
  VeilleOthers,
  VeilleRunStatus,
  VeilleSourceInput,
  VeilleStats,
  VeilleTranslation,
  VeilleSourceProbe,
  VeilleSources,
  VeilleVote,
  VeilleVoteValue,
} from "@/types/api";

import { parseStats, type StatsPeriod } from "./stats";
import { parseOthers, parseRunStatus, type VoteKind } from "./veille";

export class VeilleApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "VeilleApiError";
    this.status = status;
  }
}

// Échec temporaire (modèle illisible ou injoignable, réseau) : on peut réessayer
export function retryable(error: unknown): boolean {
  if (!(error instanceof VeilleApiError)) return true;
  return error.status === 0 || error.status >= 502;
}

async function call<T>(
  url: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      cache: "no-store",
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new VeilleApiError("le serveur est injoignable", 0);
  }
  if (!response.ok) {
    const { detail } = (await response.json().catch(() => ({}))) as {
      detail?: unknown;
    };
    throw new VeilleApiError(
      detailMessage(detail) ?? `erreur HTTP ${response.status}`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function sendVote(
  kind: VoteKind,
  id: string,
  value: VeilleVoteValue | "none",
): Promise<VeilleVote> {
  return call<VeilleVote>("api/veille/vote", "POST", { kind, id, value });
}

const promptUrl = (id: string) =>
  `api/veille/idea/${encodeURIComponent(id)}/prompt`;

function checked(answer: VeilleIdeaPrompt): VeilleIdeaPrompt {
  if (typeof answer?.prompt !== "string" || !answer.prompt)
    throw new VeilleApiError("réponse du routeur illisible", 502);
  return answer;
}

// Prompt déjà fabriqué : relu (GET) ; sinon fabriqué (POST, jusqu'à 2 minutes)
export async function loadIdeaPrompt(
  id: string,
  known: boolean,
): Promise<VeilleIdeaPrompt> {
  if (known) {
    try {
      return checked(await call<VeilleIdeaPrompt>(promptUrl(id), "GET"));
    } catch (error) {
      if (!(error instanceof VeilleApiError) || error.status !== 404)
        throw error;
    }
  }
  return checked(await call<VeilleIdeaPrompt>(promptUrl(id), "POST"));
}

// --- Sources -----------------------------------------------------------------------

const SOURCES = "api/veille/sources";

export function loadSources(): Promise<VeilleSources> {
  return call<VeilleSources>(SOURCES, "GET");
}

// Lecture d'essai, sans rien enregistrer (422 : source illisible, avec la raison)
export function testSource(
  input: VeilleSourceInput,
): Promise<VeilleSourceProbe> {
  return call<VeilleSourceProbe>(`${SOURCES}/test`, "POST", input);
}

export function addSource(
  input: VeilleSourceInput,
): Promise<VeilleCustomSource> {
  return call<VeilleCustomSource>(SOURCES, "POST", input);
}

export function updateSource(
  id: number,
  changes: Partial<Pick<VeilleCustomSource, "name" | "lang" | "category">>,
): Promise<VeilleCustomSource> {
  return call<VeilleCustomSource>(`${SOURCES}/${id}`, "PATCH", changes);
}

export function deleteSource(id: number): Promise<void> {
  return call<void>(`${SOURCES}/${id}`, "DELETE");
}

export function setBuiltinEnabled(
  name: string,
  enabled: boolean,
): Promise<{ name: string; enabled: boolean }> {
  return call(`${SOURCES}/builtin`, "POST", { name, enabled });
}

// Sources privilégiées (étoile) : 3 places garanties chacune au passage suivant
export function loadFavorites(): Promise<VeilleFavorites> {
  return call<VeilleFavorites>(`${SOURCES}/favorites`, "GET");
}

export function setFavorite(
  name: string,
  favorite: boolean,
): Promise<{ name: string; favorite: boolean }> {
  return call(`${SOURCES}/favorite`, "POST", { name, favorite });
}

// --- Articles non retenus, passage manuel ------------------------------------------

export async function loadOthers(day: string): Promise<VeilleOthers> {
  const answer = parseOthers(
    await call<unknown>(
      `api/veille/others?date=${encodeURIComponent(day)}`,
      "GET",
    ),
  );
  if (!answer) throw new VeilleApiError("réponse du routeur illisible", 502);
  return answer;
}

async function runCall(method: "GET" | "POST"): Promise<VeilleRunStatus> {
  const answer = parseRunStatus(await call<unknown>("api/veille/run", method));
  if (!answer) throw new VeilleApiError("réponse du routeur illisible", 502);
  return answer;
}

export const loadRunStatus = () => runCall("GET");
// 409 : passage déjà en cours ou appel vocal ; 429 : moins de 5 min depuis le dernier
export const requestRun = () => runCall("POST");

export async function loadStats(days: StatsPeriod): Promise<VeilleStats> {
  const answer = parseStats(
    await call<unknown>(`api/veille/stats?days=${days}`, "GET"),
  );
  if (!answer) throw new VeilleApiError("réponse du routeur illisible", 502);
  return answer;
}

// Traduction d'un article : faite par le modèle au premier appel (jusqu'à 2 minutes),
// rendue du cache du routeur ensuite
export async function translateArticle(id: string): Promise<VeilleTranslation> {
  const answer = await call<VeilleTranslation>(
    `api/veille/article/${encodeURIComponent(id)}/translate`,
    "POST",
  );
  if (typeof answer?.title !== "string" || !answer.title)
    throw new VeilleApiError("réponse du routeur illisible", 502);
  return {
    ...answer,
    summary: typeof answer.summary === "string" ? answer.summary : "",
  };
}

// Droits sur la veille : lecture seule pour un invité d'un partage ngrok
export function loadAccess(): Promise<{
  read_only: boolean;
  sharing: boolean;
}> {
  return call("api/veille/access", "GET");
}
