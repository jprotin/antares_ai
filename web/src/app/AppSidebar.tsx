// Menu de gauche (shadcn Sidebar, repliable en icônes, tiroir sur mobile) : pages du
// registre en haut, Réglages en pied. Accordéon : une entrée à sous-pages s'ouvre à la
// fois (celle de la page courante par défaut). Pendant un appel, un encart rappelle
// l'appel en cours et permet de raccrocher depuis n'importe quelle page.
import { ChevronRight, PhoneOff } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAppStore } from "@/state/hooks";
import { currentVoice } from "@/state/slices/profile";

import { pagesAt, resolve } from "./pages";
import { hrefOf } from "./router";
import { engine } from "./runtime";
import type { PageDef } from "./types";

function useCloseOnMobile() {
  const { isMobile, setOpenMobile } = useSidebar();
  return () => {
    if (isMobile) setOpenMobile(false);
  };
}

function NavItems({ items }: { items: PageDef[] }) {
  const route = useAppStore((state) => state.route);
  const close = useCloseOnMobile();
  const current = resolve(route);
  const activePath = current?.page.path;
  // Accordéon : entrée ouverte à la main pour cette page, sinon celle de la page courante
  const [toggled, setToggled] = useState<{
    route: string;
    open: string | null;
  }>({ route: "", open: null });
  const open = toggled.route === route ? toggled.open : activePath;

  return (
    <SidebarMenu>
      {items.map((item) => {
        const Icon = item.icon;
        const Badge = item.badge;
        const active = item.path === activePath;
        if (!item.children?.length)
          return (
            <SidebarMenuItem key={item.path}>
              <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                <a
                  href={hrefOf(item.path)}
                  aria-current={active ? "page" : undefined}
                  onClick={close}
                >
                  <Icon />
                  <span>{item.title}</span>
                </a>
              </SidebarMenuButton>
              {Badge && <Badge />}
            </SidebarMenuItem>
          );
        return (
          <Collapsible
            key={item.path}
            asChild
            open={open === item.path}
            onOpenChange={(next) =>
              setToggled({ route, open: next ? item.path : null })
            }
            className="group/collapsible"
          >
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton isActive={active} tooltip={item.title}>
                  <Icon />
                  <span>{item.title}</span>
                  <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                </SidebarMenuButton>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenuSub>
                  {item.children.map((sub) => {
                    const subActive = active && current?.sub?.path === sub.path;
                    return (
                      <SidebarMenuSubItem key={sub.path}>
                        <SidebarMenuSubButton asChild isActive={subActive}>
                          <a
                            href={hrefOf(`${item.path}/${sub.path}`)}
                            aria-current={subActive ? "page" : undefined}
                            onClick={close}
                          >
                            <span>{sub.title}</span>
                          </a>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    );
                  })}
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        );
      })}
    </SidebarMenu>
  );
}

// Appel en cours : statut et Raccrocher, visibles depuis toutes les pages
function CallInProgress() {
  const callState = useAppStore((state) => state.callState);
  const status = useAppStore((state) => state.status);
  if (callState === "idle") return null;
  return (
    <SidebarGroup
      className="group-data-[collapsible=icon]:hidden"
      data-testid="sidebar-call"
    >
      <SidebarGroupLabel>Appel en cours</SidebarGroupLabel>
      <SidebarGroupContent className="flex flex-col gap-2 px-2">
        <p className="truncate text-sm text-muted-foreground">{status}</p>
        <Button
          variant="destructive"
          size="sm"
          disabled={callState === "connecting"}
          onClick={() => engine.hangUp("Appel terminé")}
        >
          <PhoneOff />
          Raccrocher
        </Button>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AppSidebar() {
  const name = useAppStore((state) => currentVoice(state)?.name ?? "Antares");
  const close = useCloseOnMobile();
  return (
    <Sidebar collapsible="icon" aria-label="Menu principal">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href={hrefOf("accueil")} onClick={close}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-semibold">
                  A
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Antares</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {name}
                  </span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavItems items={pagesAt("main")} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <CallInProgress />
        <NavItems items={pagesAt("footer")} />
      </SidebarFooter>
      <SidebarRail
        aria-label="Afficher ou masquer le menu"
        title="Afficher ou masquer le menu"
      />
    </Sidebar>
  );
}
