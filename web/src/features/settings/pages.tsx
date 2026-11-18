// Sous-pages des Réglages : chaque écran (ancienne fenêtre) dans une carte de page
import { PageSection } from "@/components/PageSection";
import { AgentsDialog } from "@/features/agents";
import { ConnectionsDialog } from "@/features/connections";
import { KnowledgePanelDialog } from "@/features/knowledge";
import { RagProjectsDialog } from "@/features/rag-projects";

import { SettingsDialog } from "./SettingsDialog";

export function GeneralPage() {
  return (
    <PageSection label="Réglages" className="settings-page">
      <SettingsDialog />
    </PageSection>
  );
}

export function AgentsPage() {
  return (
    <PageSection label="Agents">
      <AgentsDialog />
    </PageSection>
  );
}

export function ConnectionsPage() {
  return (
    <PageSection label="Connexions">
      <ConnectionsDialog />
    </PageSection>
  );
}

export function RagProjectsPage() {
  return (
    <PageSection label="Projets du RAG intégré">
      <div id="rag-projects" className="contents">
        <RagProjectsDialog />
      </div>
    </PageSection>
  );
}

export function KnowledgePage() {
  return (
    <PageSection label="Connaissances">
      <div id="knowledge-panel" className="contents">
        <KnowledgePanelDialog />
      </div>
    </PageSection>
  );
}
