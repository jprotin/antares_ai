// Applique le thème enregistré avant le premier rendu (script classique, synchrone,
// externe : compatible avec script-src 'self'). Même clé et mêmes valeurs que
// l'interface actuelle (antares-theme : auto, dark ou light). Le meta color-scheme
// suit, comme dans engines/theme/theme.ts.
(function () {
  var choice = "auto";
  try {
    choice = localStorage.getItem("antares-theme") || "auto";
  } catch {
    // Stockage indisponible (navigation privée) : thème du système
  }
  if (choice !== "dark" && choice !== "light") {
    choice = matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  document.documentElement.dataset.theme = choice;
  var meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute("content", choice);
})();
