// Bloc titré d'une fiche ou de la page Méthode : Card shadcn, titre en <h3>
import type { ComponentProps, ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function Section({
  title,
  children,
  ...props
}: { title: string; children: ReactNode } & ComponentProps<typeof Card>) {
  return (
    <Card size="sm" {...props}>
      <CardHeader>
        <CardTitle>
          <h3>{title}</h3>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">{children}</CardContent>
    </Card>
  );
}
