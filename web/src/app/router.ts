// Navigation entre les pages : l'adresse après « #/ » (ex. #/reglages/agents) désigne la
// page. Pas de dépendance, rien à régler côté nginx ; retour arrière et liens directs
// fonctionnent. La page courante vit dans le store (route), lue par le menu et l'ossature.
import { store } from "@/state/store";

export const HOME_ROUTE = "accueil";

// "#/reglages/agents/" -> "reglages/agents" ; adresse vide -> accueil
export function routeOf(hash: string): string {
  const path = hash.replace(/^#\/?/, "").replace(/\/+$/, "");
  return path || HOME_ROUTE;
}

export const hrefOf = (route: string) => `#/${route}`;

export function navigate(route: string) {
  if (routeOf(window.location.hash) === route) return;
  window.location.hash = hrefOf(route);
}

// Suivi de l'adresse (une fois, au démarrage)
export function startRouter(): () => void {
  const sync = () => store.getState().setRoute(routeOf(window.location.hash));
  sync();
  window.addEventListener("hashchange", sync);
  return () => window.removeEventListener("hashchange", sync);
}
