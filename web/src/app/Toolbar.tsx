// Outils en haut à droite de la scène : boutons déclarés par le registre, par ordre
import { Button } from "@/components/ui/button";
import { store } from "@/state/store";

import { features } from "./features";

export function Toolbar() {
  const items = features
    .flatMap((feature) => (feature.toolbar ? [feature.toolbar] : []))
    .sort((a, b) => a.order - b.order);
  return (
    <div className="flex items-center gap-1">
      {items.map((item) => {
        if ("render" in item) return <item.render key={item.order} />;
        const Icon = item.icon;
        return (
          <Button
            key={item.order}
            variant="ghost"
            size="icon"
            aria-label={item.label}
            title={item.label}
            onClick={() => store.getState().showDialog(item.opens)}
          >
            <Icon className="size-5" />
          </Button>
        );
      })}
    </div>
  );
}
