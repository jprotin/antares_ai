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
