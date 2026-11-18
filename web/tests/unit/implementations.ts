// Implémentations vérifiées par les tables de caractérisation (stratégie de tests, 3.1),
// dont les vecteurs dorés ont été relevés sur l'ancienne interface.
import { hueFor } from "@/engines/theme/theme";
import {
  createNoiseGate,
  storedFilter,
} from "@/features/rehearsal/audio/noiseGate";
import { instructionsFor, writtenInstructionsFor } from "@/lib/persona";

export type NoiseGate = {
  name: string;
  calibrated: boolean;
  level: number;
  open: boolean;
  threshold: number;
  setFilter(name: string): void;
  vad(): number;
  calibrate(ms: number): Promise<number>;
  filter(buffer: ArrayBuffer): ArrayBuffer[];
  reset(): void;
};

export type Voice = { name: string; gender?: string; persona?: string };

export type Implementation = {
  name: string;
  hueFor(domain?: string): number;
  instructionsFor(voice: Voice): string;
  writtenInstructionsFor(voice: Voice): string;
};

export const implementations: Implementation[] = [
  {
    name: "web",
    hueFor,
    instructionsFor,
    writtenInstructionsFor,
  },
];

// Filtre de bruit de la Répétition
export type NoiseGateImplementation = {
  name: string;
  createNoiseGate(): NoiseGate;
  storedFilter(): string;
};

export const noiseGateImplementations: NoiseGateImplementation[] = [
  { name: "web", createNoiseGate, storedFilter },
];
