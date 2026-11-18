// Préférences du navigateur : mêmes clés que l'ancienne interface, reprises telles
// quelles. Le stockage peut lever une exception (navigation privée) : valeur par défaut.

export const STORAGE_KEYS = {
  theme: "antares-theme",
  avatar: "antares-avatar",
  noiseFilter: "antares.noiseFilter",
  // Dernière ouverture de la fenêtre Veille IA et météo (pastille)
  veilleLastOpened: "antares.veille.lastOpened",
} as const;

export function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Stockage indisponible : le choix vaut pour la session
  }
}
