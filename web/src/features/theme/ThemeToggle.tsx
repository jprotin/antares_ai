// Bouton de thème : auto -> sombre -> clair ; l'icône montre le choix courant
import { Moon, Sun, SunMoon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { THEME_LABELS } from "@/engines/theme/theme";
import { useTheme } from "@/hooks/useTheme";

const ICONS = { auto: SunMoon, dark: Moon, light: Sun } as const;

export function ThemeToggle() {
  const { choice, toggle } = useTheme();
  const Icon = ICONS[choice];
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="theme-button"
      data-choice={choice}
      title={THEME_LABELS[choice]}
      aria-label={THEME_LABELS[choice]}
      onClick={toggle}
    >
      <Icon />
    </Button>
  );
}
