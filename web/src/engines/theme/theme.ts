// Thème clair, sombre ou système, et teinte selon le domaine de l'agent actif (port de
// theme.js). Seule la teinte varie ; luminosité et saturation sont communes (--hue).
import { readPreference, STORAGE_KEYS, writePreference } from "@/lib/storage";

export const BASE_HUE = 222;
const DOMAIN_HUES: Record<string, number> = {
  "Infra & DevOps": 228,
  "Exploitation / SRE": 208,
  Sécurité: 246,
  Développement: 216,
  Données: 194,
  "Gestion de projet": 262,
  Rédaction: 276,
  Perso: 182,
};
// Domaines personnels : teinte stable dérivée du nom, dans la même plage
const CUSTOM_RANGE = [182, 276] as const;

export const THEMES = ["auto", "dark", "light"] as const;
export type ThemeChoice = (typeof THEMES)[number];
export type ResolvedTheme = "dark" | "light";

export const THEME_LABELS: Record<ThemeChoice, string> = {
  auto: "Thème : système",
  dark: "Thème : sombre",
  light: "Thème : clair",
};

export function hueFor(domain?: string): number {
  if (!domain) return BASE_HUE;
  const known = DOMAIN_HUES[domain];
  if (known !== undefined) return known;
  let hash = 0;
  for (const char of domain) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const [low, high] = CUSTOM_RANGE;
  return low + (hash % (high - low));
}

export function storedTheme(): ThemeChoice {
  const value = readPreference(STORAGE_KEYS.theme);
  return (THEMES as readonly string[]).includes(value ?? "")
    ? (value as ThemeChoice)
    : "auto";
}

export function nextTheme(choice: ThemeChoice): ThemeChoice {
  return THEMES[(THEMES.indexOf(choice) + 1) % THEMES.length] ?? "auto";
}

const lightMedia = () => matchMedia("(prefers-color-scheme: light)");

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice !== "auto") return choice;
  return lightMedia().matches ? "light" : "dark";
}

// Pose le thème sur <html> (data-theme et meta color-scheme), comme theme-init.js
export function applyTheme(choice: ThemeChoice): ResolvedTheme {
  const resolved = resolveTheme(choice);
  document.documentElement.dataset.theme = resolved;
  document
    .querySelector('meta[name="color-scheme"]')
    ?.setAttribute("content", resolved);
  return resolved;
}

export function saveTheme(choice: ThemeChoice): void {
  writePreference(STORAGE_KEYS.theme, choice);
}

// Suivi de l'OS : rappelé à chaque changement de préférence du système
export function watchSystemTheme(onChange: () => void): () => void {
  const media = lightMedia();
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

// Teinte de l'agent actif : variable CSS en CSSOM (compatible style-src 'self')
export function setDomainHue(domain?: string): number {
  const hue = hueFor(domain);
  document.documentElement.style.setProperty("--hue", String(hue));
  return hue;
}
