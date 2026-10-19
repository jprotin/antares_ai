// Libellés du modèle et du projet (port de settings.js)

export function modelLabel(name?: string | null): string {
  if (name?.startsWith("claude:")) {
    const model = name.slice("claude:".length);
    return `Claude ${model.charAt(0).toUpperCase()}${model.slice(1)} (hors local)`;
  }
  // « fournisseur/modèle » : le modèle, suivi du fournisseur s'il n'est pas Ollama
  const [provider, ...rest] = (name ?? "?").split("/");
  if (!rest.length) return name ?? "?";
  const model = rest.join("/");
  return provider === "ollama" ? model : `${model} (${provider})`;
}

export function projectLabel(project?: string | null): string {
  return project || "aucun (projet cité par son nom)";
}

export type ModelEntry = {
  name: string;
  label?: string;
  provider?: string;
  providerName?: string;
  local?: boolean;
  available?: boolean;
  parameterSize?: string;
  sizeGb?: number;
  observed?: { ttft: number; speed: number };
};

// Vitesse mesurée par le routeur sur les vraies conversations. À l'oral, ~4 tokens/s
// suffisent pour suivre la parole : au-delà de 15, la réponse ne prend pas de retard.
export function modelBadge(model: ModelEntry): [string, string] {
  const observed = model.observed;
  if (model.available === false) return ["badge--unknown", "indisponible"];
  if (model.provider === "claude") {
    const delay = observed
      ? ` · ~${Math.round(observed.ttft)} s par réponse`
      : "";
    return ["badge--cloud", `hors local${delay}`];
  }
  if (!observed) {
    return model.local === false
      ? ["badge--cloud", "hors local"]
      : ["badge--unknown", "pas encore utilisé"];
  }
  const speed = `${Math.round(observed.speed)} tok/s · 1er mot ${observed.ttft.toFixed(1).replace(".", ",")} s`;
  return [observed.speed >= 15 ? "badge--gpu" : "badge--slow", speed];
}

export function modelDetail(model: ModelEntry): string {
  if (model.provider === "claude") {
    return "Claude Code (abonnement) · la conversation écrite est envoyée à Anthropic";
  }
  if (model.provider === "openai") {
    return `${model.providerName} (API compatible OpenAI)${model.local ? "" : " · hors local"}`;
  }
  return `${model.providerName ?? "Ollama"} · ${model.parameterSize ?? "?"} paramètres · ${model.sizeGb} Go`;
}
