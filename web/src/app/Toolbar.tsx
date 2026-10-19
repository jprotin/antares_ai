// Outils en haut à droite de la scène : boutons déclarés par le registre, par ordre
import { store } from "@/state/store";

import { features } from "./features";

export function Toolbar() {
  const items = features
    .flatMap((feature) =>
      feature.toolbar ? [{ id: feature.id, item: feature.toolbar }] : [],
    )
    .sort((a, b) => a.item.order - b.item.order);
  return (
    <>
      {items.map(({ id, item }) => {
        if ("render" in item) return <item.render key={id} />;
        const Icon = item.icon;
        return (
          <button
            key={id}
            type="button"
            className="settings-button"
            aria-label={item.label}
            title={item.label}
            onClick={() => store.getState().showDialog(item.opens)}
          >
            <Icon />
          </button>
        );
      })}
    </>
  );
}
