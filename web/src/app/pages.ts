// Pages déclarées par le registre (FeatureDef.page) : menu de gauche et page affichée
// selon l'adresse (app/router.ts).
import { features } from "./features";
import { HOME_ROUTE } from "./router";
import type { PageDef, SubPageDef } from "./types";

export const pages: PageDef[] = features
  .flatMap((feature) => (feature.page ? [feature.page] : []))
  .sort((a, b) => a.order - b.order);

export const pagesAt = (placement: PageDef["placement"]) =>
  pages.filter((page) => page.placement === placement);

export type Resolved = { page: PageDef; sub?: SubPageDef };

// "reglages/agents" -> Réglages, sous-page Agents ; page sans contenu propre -> sa
// première sous-page ; adresse inconnue -> accueil
export function resolve(route: string): Resolved | null {
  const [head, rest] = route.split("/", 2);
  const page =
    pages.find((p) => p.path === head) ??
    pages.find((p) => p.path === HOME_ROUTE);
  if (!page) return null;
  const sub =
    (page.path === head && rest
      ? page.children?.find((c) => c.path === rest)
      : undefined) ?? (page.render ? undefined : page.children?.[0]);
  return { page, sub };
}

export const routeOfPage = ({ page, sub }: Resolved) =>
  sub ? `${page.path}/${sub.path}` : page.path;
