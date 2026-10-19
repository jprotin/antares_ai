// Implémentations comparées par les tables de caractérisation (stratégie de tests, 3.1) :
// l'ancien module tel quel, puis le nouveau dès qu'il existe (lots 2, 3 et 6).
// @ts-expect-error module JS de l'ancienne interface, sans types
import * as legacyGate from "../../../frontend/noise-gate.js";
// @ts-expect-error idem
import * as legacySettings from "../../../frontend/settings.js";
// @ts-expect-error idem
import * as legacyTheme from "../../../frontend/theme.js";

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
  createNoiseGate(): NoiseGate;
  storedFilter(): string;
  hueFor(domain?: string): number;
  instructionsFor(voice: Voice): string;
  writtenInstructionsFor(voice: Voice): string;
};

export const implementations: Implementation[] = [
  {
    name: "legacy",
    createNoiseGate: legacyGate.createNoiseGate,
    storedFilter: legacyGate.storedFilter,
    hueFor: legacyTheme.hueFor,
    instructionsFor: legacySettings.instructionsFor,
    writtenInstructionsFor: legacySettings.writtenInstructionsFor,
  },
];
