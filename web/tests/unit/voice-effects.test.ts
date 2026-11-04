// Effets de lecture : courbe de saturation (logique pure) et contrat avec le catalogue des
// voix (deploy/s2s/voices/voices.json : champ "effect")
import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { driveCurve, VOICE_EFFECTS } from "@/engines/realtime/voiceEffects";

const catalog = JSON.parse(
  readFileSync(
    new URL("../../../deploy/s2s/voices/voices.json", import.meta.url),
    "utf8",
  ),
) as { voices: { id: string; effect?: string }[] };

describe("effets de lecture", () => {
  test("saturation : impaire, bornée, quasi linéaire à bas niveau", () => {
    const drive = 10 ** (8 / 20);
    const curve = driveCurve(drive, 1025);
    const at = (index: number) => curve[index] ?? Number.NaN;
    expect(at(0)).toBeCloseTo(-at(1024), 6);
    expect(at(512)).toBeCloseTo(0, 6);
    expect(Math.max(...curve)).toBeLessThan(1 / drive + 1e-6);
    // x = 0,01 : moins de 0,5 % d'écart avec la droite
    const low = at(517);
    const x = (517 / 1024) * 2 - 1;
    expect(Math.abs(low - x) / x).toBeLessThan(0.005);
  });

  test("rauque : vitesse normale, toute la bande, voix rauque, sans écho", () => {
    const preset =
      VOICE_EFFECTS.rauque ?? expect.unreachable("effet rauque absent");
    expect(preset.rate).toBe(1);
    expect(preset.echoes).toEqual([]);
    expect(preset.band[0]).toBeLessThanOrEqual(80);
    // Contexte audio à 24 kHz : passe-bas sous Nyquist
    expect(preset.band[1]).toBeLessThan(12000);
    expect(preset.drive).toBeGreaterThan(1);
  });

  test("chaque effet du catalogue existe", () => {
    for (const voice of catalog.voices) {
      if (voice.effect)
        expect(VOICE_EFFECTS, voice.id).toHaveProperty(voice.effect);
    }
  });
});
