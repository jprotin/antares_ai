// Choix du thème (auto, sombre, clair) : déjà posé par theme-init.js avant le rendu,
// repris ici, persisté à chaque bascule et recalculé quand l'OS change de préférence.
import { useCallback, useEffect, useState } from "react";

import { avatar } from "@/engines/avatar/AvatarHost";
import {
  applyTheme,
  nextTheme,
  saveTheme,
  storedTheme,
  watchSystemTheme,
  type ThemeChoice,
} from "@/engines/theme/theme";

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(storedTheme);

  // Thème résolu posé sur <html> et transmis à l'avatar (couleurs de l'orbe)
  useEffect(() => {
    const apply = () => avatar.setTheme(applyTheme(choice));
    apply();
    return watchSystemTheme(apply);
  }, [choice]);

  const toggle = useCallback(() => {
    const next = nextTheme(choice);
    saveTheme(next);
    setChoice(next);
  }, [choice]);

  return { choice, toggle };
}
