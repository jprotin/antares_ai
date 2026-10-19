// Fenêtre propre à la Répétition (visionneuse, historique de la note) : portail dans
// #feature-portal, masqué à l'impression avec le reste hors du rapport
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";

// Valeur de FEATURE_PORTAL_ID (app/AppShell.tsx), non importée : AppShell importe le
// registre, donc cette fonctionnalité (contrôlé par tests/unit/rehearsal.test.ts)
export const FEATURE_PORTAL_ID = "feature-portal";

type Props = {
  open: boolean;
  onClose(): void;
  className: string;
  title: string;
  // Titre visible (historique) ou seulement lu par les lecteurs d'écran (visionneuse)
  showTitle?: boolean;
  children: ReactNode;
  onContentClick?(): void;
};

export function LocalDialog({
  open,
  onClose,
  className,
  title,
  showTitle = false,
  children,
  onContentClick,
}: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal container={document.getElementById(FEATURE_PORTAL_ID)}>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content
          className={`dialog-panel ${className}`}
          aria-describedby={undefined}
          onClick={onContentClick}
        >
          {!showTitle && (
            <Dialog.Title className="sr-only">{title}</Dialog.Title>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
