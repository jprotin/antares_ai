// Valeur mise à jour au plus une fois par image affichée (rendu Markdown en flux,
// même cadencement que renderInto dans render.js)
import { useEffect, useState } from "react";

export function useRafThrottled<T>(value: T): T {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return shown;
}
