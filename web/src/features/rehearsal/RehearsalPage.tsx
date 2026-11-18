// Page Répétition : préparation et historique ; pendant une répétition (et son rapport),
// la zone d'appel avec le panneau de la répétition.
import { useEffect } from "react";

import { PageSection } from "@/components/PageSection";
import { Workspace } from "@/features/call";
import { useAppStore } from "@/state/hooks";

import { rehearsal } from "./instance";
import { SetupDialog } from "./SetupDialog";

export function RehearsalPage() {
  const live = useAppStore((state) => Boolean(state.rootData.rehearsal));
  // Publics et historique rechargés à chaque arrivée sur la page
  useEffect(() => {
    if (!live) void rehearsal.loadSetup();
  }, [live]);
  if (live) return <Workspace />;
  return (
    <PageSection label="Répéter une présentation" className="rehearsal-setup">
      <SetupDialog />
    </PageSection>
  );
}
