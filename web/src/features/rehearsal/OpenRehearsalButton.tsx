// Bouton de la barre : ouvre la préparation (et l'historique) de la Répétition
import { rehearsal } from "./instance";

export function OpenRehearsalButton() {
  return (
    <button
      type="button"
      className="settings-button"
      id="open-rehearsal"
      aria-label="Répéter une présentation"
      title="Répéter une présentation"
      onClick={() => rehearsal.openSetup()}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        <path d="M3 3h18a1 1 0 0 1 0 2h-1v10a2 2 0 0 1-2 2h-5v1.6l3.2 2.6a1 1 0 1 1-1.3 1.6L12 20.3l-2.9 2.5a1 1 0 0 1-1.3-1.6l3.2-2.6V17H6a2 2 0 0 1-2-2V5H3a1 1 0 0 1 0-2Zm3 2v10h12V5H6Zm2 7.5 3-3 2 2 3-3.5 1.5 1.3-4.4 5.1-2.1-2.1-1.6 1.6L8 12.5Z" />
      </svg>
    </button>
  );
}
