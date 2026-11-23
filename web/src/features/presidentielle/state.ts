// État de la page « Présidentielle 2027 » : base publiée, méta (partage, invité, cible)
// et ordre des candidats tiré une fois par visite (chargement de l'application), partagé
// par la liste, l'assistant et le rapport du quiz. Nouveau tirage à la visite suivante,
// ou si la liste des candidats change.
import { createStore } from "zustand/vanilla";

import { loadBase, loadMeta } from "./api";
import { shuffle, type Rng } from "./shuffle";
import type { BasePubliee, Candidat, Meta } from "./types";

type Status = "idle" | "loading" | "ready" | "error";

type PresidentielleState = {
  status: Status;
  error: string | null;
  base: BasePubliee | null;
  meta: Meta | null;
  // Identifiants des candidats dans l'ordre tiré
  order: string[] | null;
};

const initial = (): PresidentielleState => ({
  status: "idle",
  error: null,
  base: null,
  meta: null,
  order: null,
});

export const presidentielleStore = createStore<PresidentielleState>()(initial);

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length &&
  [...a].sort().join("\n") === [...b].sort().join("\n");

// Ordre de la visite : tiré au premier appel, rendu tel quel ensuite
export function visitOrder(ids: readonly string[], rng?: Rng): string[] {
  const current = presidentielleStore.getState().order;
  if (current && sameSet(current, ids)) return current;
  const order = shuffle(ids, rng);
  presidentielleStore.setState({ order });
  return order;
}

// Candidats dans l'ordre de la visite (ceux que l'ordre ne connaît pas : à la fin)
export function inVisitOrder(
  candidats: readonly Candidat[],
  order: readonly string[] | null,
): Candidat[] {
  if (!order) return [...candidats];
  const rank = new Map(order.map((id, index) => [id, index]));
  const at = (c: Candidat) => rank.get(c.id) ?? order.length;
  return [...candidats].sort((a, b) => at(a) - at(b));
}

// Lecture de la base et de la méta ; la méta est facultative (bandeaux d'invité et de
// cible absents si elle manque), la base non.
// Relecture en échec (chaque sous-page relit au montage) : si une base a déjà été lue,
// elle reste affichée avec la dernière méta et le même ordre ; l'état passe à « error »,
// la page montre l'alerte « Lecture impossible » et son bouton « Réessayer ». Une
// relecture réussie efface l'erreur.
export async function loadPresidentielle(): Promise<void> {
  const known = presidentielleStore.getState().base !== null;
  presidentielleStore.setState({
    status: known ? "ready" : "loading",
    error: null,
  });
  const [base, meta] = await Promise.allSettled([loadBase(), loadMeta()]);
  if (base.status === "rejected") {
    presidentielleStore.setState({
      status: "error",
      error:
        base.reason instanceof Error
          ? base.reason.message
          : String(base.reason),
    });
    return;
  }
  visitOrder(base.value.candidats.map((c) => c.id));
  presidentielleStore.setState({
    status: "ready",
    base: base.value,
    meta: meta.status === "fulfilled" ? meta.value : null,
  });
}
