// Thème : clair / sombre (ou celui du système) et nuance de couleur selon le domaine
// de l'agent actif. Les nuances restent proches de la teinte de base (bleu) : seule la
// teinte varie, luminosité et saturation sont communes (cf. style.css, --hue).

const BASE_HUE = 222;
const DOMAIN_HUES = {
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
const CUSTOM_RANGE = [182, 276];
const STORAGE_KEY = "antares-theme";
const THEMES = ["auto", "dark", "light"];
const THEME_LABELS = {
  auto: "Thème : système",
  dark: "Thème : sombre",
  light: "Thème : clair",
};

export function hueFor(domain) {
  if (!domain) return BASE_HUE;
  if (domain in DOMAIN_HUES) return DOMAIN_HUES[domain];
  let hash = 0;
  for (const char of domain) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const [low, high] = CUSTOM_RANGE;
  return low + (hash % (high - low));
}

function storedTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "auto";
  } catch {
    return "auto";
  }
}

export function initTheme({ button, orb }) {
  const media = matchMedia("(prefers-color-scheme: light)");
  let choice = THEMES.includes(storedTheme()) ? storedTheme() : "auto";

  function apply() {
    const resolved =
      choice === "auto" ? (media.matches ? "light" : "dark") : choice;
    document.documentElement.dataset.theme = resolved;
    document
      .querySelector('meta[name="color-scheme"]')
      ?.setAttribute("content", resolved);
    button.dataset.choice = choice;
    button.title = THEME_LABELS[choice];
    button.setAttribute("aria-label", THEME_LABELS[choice]);
    orb.setTheme(resolved);
  }

  button.addEventListener("click", () => {
    choice = THEMES[(THEMES.indexOf(choice) + 1) % THEMES.length];
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Stockage indisponible (navigation privée) : le choix vaut pour la session
    }
    apply();
  });
  media.addEventListener("change", apply);
  apply();

  return {
    setDomain(domain) {
      const hue = hueFor(domain);
      document.documentElement.style.setProperty("--hue", hue);
      orb.setHue(hue - BASE_HUE);
    },
  };
}
