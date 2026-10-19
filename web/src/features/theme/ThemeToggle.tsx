// Bouton de thème : auto -> sombre -> clair ; l'icône du choix courant est affichée
// par la feuille (data-choice), comme dans l'ancienne interface
import {
  ThemeAutoIcon,
  ThemeDarkIcon,
  ThemeLightIcon,
} from "@/components/icons";
import { THEME_LABELS } from "@/engines/theme/theme";
import { useTheme } from "@/hooks/useTheme";

export function ThemeToggle() {
  const { choice, toggle } = useTheme();
  return (
    <button
      type="button"
      className="settings-button theme-button"
      data-choice={choice}
      title={THEME_LABELS[choice]}
      aria-label={THEME_LABELS[choice]}
      onClick={toggle}
    >
      <ThemeAutoIcon className="icon-auto" />
      <ThemeDarkIcon className="icon-dark" />
      <ThemeLightIcon className="icon-light" />
    </button>
  );
}
