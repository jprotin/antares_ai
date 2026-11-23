// Lectures de la base « Présidentielle 2027 » (routeur, lecture seule) : base publiée et
// méta (partage, invité, cible). Erreurs avec leur statut HTTP (0 : serveur injoignable).
import { detailMessage } from "@/lib/api";

import type { BasePubliee, Meta } from "./types";

export class PresidentielleApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PresidentielleApiError";
    this.status = status;
  }
}

async function read<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch {
    throw new PresidentielleApiError("le serveur est injoignable", 0);
  }
  if (!response.ok) {
    const { detail } = (await response.json().catch(() => ({}))) as {
      detail?: unknown;
    };
    throw new PresidentielleApiError(
      detailMessage(detail) ?? `erreur HTTP ${response.status}`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

function checkedBase(answer: BasePubliee): BasePubliee {
  if (
    !answer ||
    typeof answer.version !== "string" ||
    !Array.isArray(answer.candidats) ||
    !Array.isArray(answer.themes) ||
    !Array.isArray(answer.journal)
  )
    throw new PresidentielleApiError("réponse du routeur illisible", 502);
  return answer;
}

export async function loadBase(): Promise<BasePubliee> {
  return checkedBase(await read<BasePubliee>("api/presidentielle"));
}

export function loadMeta(): Promise<Meta> {
  return read<Meta>("api/presidentielle/meta");
}
