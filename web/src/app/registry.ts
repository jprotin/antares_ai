// Lecture du registre au rendu (pas à l'import : features.ts importe les fonctionnalités)
import { features } from "./features";

export function isDialogRegistered(id: string): boolean {
  return features.some((feature) => feature.dialogs?.some((d) => d.id === id));
}
