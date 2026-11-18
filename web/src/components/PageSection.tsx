// Contenu d'un écran affiché en page (Réglages, Répétition…) : zone nommée (repère
// d'accessibilité et des tests), carte shadcn centrée, titre et Fermer adaptés à la page.
import type { ReactNode } from "react";

import { SurfaceContext } from "@/app/surface";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function PageSection({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <SurfaceContext.Provider value="page">
      <section aria-label={label} className="flex justify-center p-4 md:p-6">
        <Card
          className={cn(
            "agents w-full max-w-3xl gap-0 py-0 text-base",
            className,
          )}
        >
          {children}
        </Card>
      </section>
    </SurfaceContext.Provider>
  );
}
