// Consignes du personnage et teinte par agent : mêmes résultats que l'ancienne interface
// (vecteurs dorés relevés sur les modules legacy : fixtures/persona-theme.json).
import { describe, expect, test } from "vitest";

import golden from "./fixtures/persona-theme.json";
import { implementations } from "./implementations";

const VOICES = golden.voices;
type Kind = keyof typeof VOICES;

describe.each(implementations)("persona et teinte ($name)", (impl) => {
  test.each(Object.keys(VOICES) as Kind[])(
    "test_instructionsFor_%s_identique",
    (kind) => {
      expect(impl.instructionsFor(VOICES[kind])).toBe(
        golden.instructions[kind],
      );
      expect(impl.writtenInstructionsFor(VOICES[kind])).toBe(
        golden.written[kind],
      );
    },
  );

  test.each([
    ["Infra & DevOps", 228],
    ["Exploitation / SRE", 208],
    ["Sécurité", 246],
    ["Développement", 216],
    ["Données", 194],
    ["Gestion de projet", 262],
    ["Rédaction", 276],
    ["Perso", 182],
  ])("test_hueFor_%s_%d", (domain, hue) => {
    expect(impl.hueFor(domain)).toBe(hue);
  });

  test("test_hueFor_sans_domaine_222", () => {
    expect(impl.hueFor(undefined)).toBe(222);
  });

  test.each(["Mon domaine", "Cuisine 🍳", "Électronique"])(
    "test_hueFor_domaine_perso_stable_dans_la_plage (%s)",
    (domain) => {
      const hue = impl.hueFor(domain);
      expect(hue).toBe(impl.hueFor(domain));
      expect(hue).toBeGreaterThanOrEqual(182);
      expect(hue).toBeLessThan(276);
      expect(hue).toBe(golden.hues[domain as keyof typeof golden.hues]);
    },
  );
});
