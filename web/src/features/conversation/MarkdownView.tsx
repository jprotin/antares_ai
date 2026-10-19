// Seul point d'entrée du HTML brut (règle eslint) : Markdown nettoyé par DOMPurify
import { useMemo } from "react";

import { useRafThrottled } from "@/hooks/useRafThrottled";
import { renderAnswer } from "@/lib/markdown";

type Props = {
  text: string;
  className?: string;
  // Réponse avec sources web : renvois [n] liés aux sources (identifiants préfixés)
  sourcePrefix?: string;
  sourceCount?: number;
  as?: "span" | "div";
  // Texte en cours de flux : rendu au plus une fois par image ; final : tout de suite
  streaming?: boolean;
};

export function MarkdownView({
  text,
  className,
  sourcePrefix = "",
  sourceCount = 0,
  as = "span",
  streaming = false,
}: Props) {
  const throttled = useRafThrottled(text);
  const shown = streaming ? throttled : text;
  const html = useMemo(
    () => renderAnswer(shown, { prefix: sourcePrefix, count: sourceCount }),
    [shown, sourcePrefix, sourceCount],
  );
  const Tag = as;
  return (
    <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
