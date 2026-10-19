// Appels au routeur (/api) et aux fichiers servis par nginx : URL relatives, mêmes
// messages d'erreur que l'ancienne interface (settings.js, app.js).

export const HTTP_ERRORS: Record<number, string> = {
  413: "la conversation est trop longue pour être envoyée",
  502: "le routeur LLM ne répond pas",
  504: "le modèle a mis trop de temps à répondre",
};

type ValidationError = { loc?: (string | number)[]; msg: string };

// Erreurs de validation : liste de champs refusés, « champ : message » séparés par « ; »
export function detailMessage(detail: unknown): string | undefined {
  if (Array.isArray(detail))
    return (detail as ValidationError[])
      .map((d) => `${d.loc?.at(-1)} : ${d.msg}`)
      .join(" ; ");
  return typeof detail === "string" ? detail : undefined;
}

export async function getJson<T = unknown>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  if (!response.ok) {
    const { detail } = (await response.json().catch(() => ({}))) as {
      detail?: unknown;
    };
    throw new Error(
      detailMessage(detail) ?? `${url} : HTTP ${response.status}`,
    );
  }
  return response.json() as Promise<T>;
}

export function sendJson<T = unknown>(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  return getJson<T>(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Suppression : seul le statut compte (le corps d'un 204 est vide) ; message du serveur
// en cas d'échec
export async function deleteResource(url: string): Promise<void> {
  const response = await fetch(url, { method: "DELETE" });
  if (response.ok) return;
  const { detail } = (await response.json().catch(() => ({}))) as {
    detail?: unknown;
  };
  throw new Error(detailMessage(detail) ?? `${url} : HTTP ${response.status}`);
}

// Message d'une réponse HTTP en échec du flux écrit (/api/chat)
export function httpError(status: number): Error {
  return new Error(HTTP_ERRORS[status] ?? `erreur HTTP ${status}`);
}

// Raison affichée dans la conversation : une coupure réseau est une TypeError de fetch
export function failureReason(error: unknown): string {
  if (error instanceof TypeError) return "le serveur est injoignable";
  return error instanceof Error ? error.message : String(error);
}
