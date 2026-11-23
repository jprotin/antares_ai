// Nature d'un texte : citation « du candidat » ou texte « de la rédaction » ; explication
// au survol par le Tooltip shadcn (positionné par le CSSOM, permis par la CSP)
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { NATURE_LABEL } from "./labels";

const NATURE_HELP = {
  candidat: "Citation exacte d'un document du candidat",
  redaction: "Texte écrit par la rédaction de cette page",
} as const;

export function NatureTag({ nature }: { nature: keyof typeof NATURE_LABEL }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" data-nature={nature}>
          {NATURE_LABEL[nature]}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{NATURE_HELP[nature]}</TooltipContent>
    </Tooltip>
  );
}
