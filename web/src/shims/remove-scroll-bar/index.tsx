// Remplace react-remove-scroll-bar (alias dans vite.config.ts) : l'original injecte une
// balise <style> à l'exécution, bloquée par style-src 'self'. Ici, les règles sont
// statiques (scroll-lock.css) et seule la largeur de la barre est écrite en CSSOM.
import { useEffect, useMemo } from "react";

import {
  fullWidthClassName,
  noScrollbarsClassName,
  removedBarSizeVariable,
  zeroRightClassName,
} from "./constants";

export {
  fullWidthClassName,
  noScrollbarsClassName,
  removedBarSizeVariable,
  zeroRightClassName,
};

export const lockAttribute = "data-scroll-locked";

type GapMode = "margin" | "padding";

export function getGapWidth(gapMode: GapMode = "margin") {
  const style = window.getComputedStyle(document.body);
  const left =
    parseInt(
      gapMode === "padding" ? style.paddingLeft : style.marginLeft,
      10,
    ) || 0;
  const right =
    parseInt(
      gapMode === "padding" ? style.paddingRight : style.marginRight,
      10,
    ) || 0;
  const top =
    parseInt(gapMode === "padding" ? style.paddingTop : style.marginTop, 10) ||
    0;
  const gap = Math.max(
    0,
    window.innerWidth - document.documentElement.clientWidth + right - left,
  );
  return { left, top, right, gap };
}

function lockCount(): number {
  return parseInt(document.body.getAttribute(lockAttribute) ?? "0", 10) || 0;
}

export function RemoveScrollBar({
  gapMode = "margin",
}: {
  gapMode?: GapMode;
  noRelative?: boolean;
  noImportant?: boolean;
}) {
  const gap = useMemo(() => getGapWidth(gapMode).gap, [gapMode]);

  useEffect(() => {
    const body = document.body;
    if (lockCount() === 0)
      body.style.setProperty(removedBarSizeVariable, `${gap}px`);
    body.setAttribute(lockAttribute, String(lockCount() + 1));
    return () => {
      const next = lockCount() - 1;
      if (next > 0) {
        body.setAttribute(lockAttribute, String(next));
        return;
      }
      body.removeAttribute(lockAttribute);
      body.style.removeProperty(removedBarSizeVariable);
    };
  }, [gap]);

  return null;
}
