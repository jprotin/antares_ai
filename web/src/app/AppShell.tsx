// Ossature de l'écran (shadcn Sidebar) : menu de gauche, barre du haut (bouton du menu,
// fil d'Ariane, réseau, thème), page de l'adresse courante (app/router.ts). La sortie
// audio et les fenêtres restent montées : l'appel continue quand on change de page.
import { Fragment, useEffect, useRef } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NetIndicator } from "@/features/net";
import { ThemeToggle } from "@/features/theme";
import { useAppStore } from "@/state/hooks";
import { currentVoice } from "@/state/slices/profile";

import { AppSidebar } from "./AppSidebar";
import { DialogHost } from "./DialogHost";
import { resolve, routeOfPage, type Resolved } from "./pages";
import { hrefOf } from "./router";
import { engine } from "./runtime";
import "./shell.css";

// Identifiant du conteneur des portails propres à une fonctionnalité (visionneuse de
// slides) : dans #root, donc soumis aux règles d'impression de la fonctionnalité
export const FEATURE_PORTAL_ID = "feature-portal";

function Trail({ resolved }: { resolved: Resolved }) {
  const { page, sub } = resolved;
  const crumbs = sub
    ? [
        { title: page.title, href: hrefOf(page.path) },
        { title: sub.title, href: null },
      ]
    : [{ title: page.title, href: null }];
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, i) => (
          <Fragment key={crumb.title}>
            {i > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {crumb.href ? (
                <BreadcrumbLink href={crumb.href}>{crumb.title}</BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{crumb.title}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function AppShell() {
  const callState = useAppStore((state) => state.callState);
  const rootData = useAppStore((state) => state.rootData);
  const route = useAppStore((state) => state.route);
  const name = useAppStore((state) => currentVoice(state)?.name ?? "Antares");
  const speaker = useRef<HTMLAudioElement>(null);
  const resolved = resolve(route);
  const Page = resolved?.sub?.render ?? resolved?.page.render;
  const pageKey = resolved ? routeOfPage(resolved) : "";

  useEffect(() => {
    document.title = `${name} · Antares`;
  }, [name]);

  useEffect(() => {
    engine.attachSpeaker(speaker.current);
    return () => engine.attachSpeaker(null);
  }, []);

  const dataAttributes = Object.fromEntries(
    Object.entries(rootData).map(([key, value]) => [`data-${key}`, value]),
  );
  return (
    <TooltipProvider>
      <SidebarProvider className="h-svh overflow-hidden">
        <AppSidebar />
        <SidebarInset
          className="min-h-0 overflow-hidden"
          data-testid="app"
          data-state={callState}
          data-page={pageKey}
          {...dataAttributes}
        >
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger
              className="-ml-1"
              aria-label="Afficher ou masquer le menu"
              title="Afficher ou masquer le menu"
            />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            {resolved && <Trail resolved={resolved} />}
            <div className="ml-auto flex items-center gap-2">
              <NetIndicator />
              <ThemeToggle />
            </div>
          </header>
          <div className="shell__page" key={pageKey}>
            {Page && <Page />}
          </div>
        </SidebarInset>
        <DialogHost />
      </SidebarProvider>
      <audio ref={speaker} autoPlay hidden data-testid="speaker" />
      {/* Hors de la grille, mais dans #root */}
      <div id={FEATURE_PORTAL_ID} />
    </TooltipProvider>
  );
}
