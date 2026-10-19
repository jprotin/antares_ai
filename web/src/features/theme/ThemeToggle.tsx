// Bouton de thème : auto -> sombre -> clair, icône et libellé du choix courant
import { Button } from "@/components/ui/button";
import {
  ThemeAutoIcon,
  ThemeDarkIcon,
  ThemeLightIcon,
} from "@/components/icons";
import { THEME_LABELS } from "@/engines/theme/theme";
import { useTheme } from "@/hooks/useTheme";

const ICONS = {
  auto: ThemeAutoIcon,
  dark: ThemeDarkIcon,
  light: ThemeLightIcon,
};

export function ThemeToggle() {
  const { choice, toggle } = useTheme();
  const Icon = ICONS[choice];
  return (
    <Button
      variant="ghost"
      size="icon"
      data-choice={choice}
      title={THEME_LABELS[choice]}
      aria-label={THEME_LABELS[choice]}
      onClick={toggle}
    >
      <Icon className="size-5" />
    </Button>
  );
}
