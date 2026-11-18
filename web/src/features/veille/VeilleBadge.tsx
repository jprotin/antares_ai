// Pastille de l'entrée Actualités du menu : allumée quand un passage est plus récent que
// la dernière ouverture de la page. Relève aussi le dernier passage (interrogation
// périodique), après le premier relevé du réseau. Présente pendant un partage public (la
// veille y est en lecture seule pour les invités, cf. router/veille_access.py).
import { useStore } from "zustand";

import { SidebarMenuBadge } from "@/components/ui/sidebar";
import { useVeillePolling } from "./polling";
import { veilleStore } from "./state";
import { hasNews } from "./veille";

export function VeilleBadge() {
  useVeillePolling();
  const latestAt = useStore(veilleStore, (s) => s.latest?.run?.finished_at);
  const lastOpened = useStore(veilleStore, (s) => s.lastOpened);
  const fresh = hasNews(latestAt, lastOpened);
  if (!fresh) return null;
  return (
    <SidebarMenuBadge
      data-testid="veille-fresh"
      title="Nouvelle veille disponible"
    >
      <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
      <span className="sr-only">Nouvelle veille disponible</span>
    </SidebarMenuBadge>
  );
}
