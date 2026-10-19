// Répétition (stratégie de tests, 3.2) : machine d'états, analyse des transcriptions,
// contrat des repères avec le routeur (deploy/s2s/router/rehearsal.py)
import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import {
  holdsMic,
  isActive,
  isFragment,
  isSilent,
  meterPosition,
  NEXT_LABEL,
  QA_MARKER,
  reportMarker,
  revised,
  slidesHidden,
  stepStates,
  wordCount,
  formatDate,
  type Phase,
} from "@/features/rehearsal/rehearsalMachine";

const PHASES: Phase[] = ["speech", "qa", "analysis", "report"];

describe("contrat routeur", () => {
  // Racine de Vitest : web/
  const python = readFileSync("../deploy/s2s/router/rehearsal.py", "utf8");
  const constant = (name: string) =>
    new RegExp(`^${name} = "([^"]*)"`, "m").exec(python)?.[1];

  test("test_QA_MARKER_identique_au_routeur", () => {
    expect(constant("QA_MARKER")).toBe(QA_MARKER);
  });

  test("test_reportMarker_prefixe_identique_au_routeur", () => {
    const prefix = constant("REPORT_MARKER");
    expect(prefix).toBeTruthy();
    expect(reportMarker(3)).toBe(`${prefix}3]`);
    // Le routeur relit l'index par expression régulière : préfixe puis nombre et ]
    expect(
      new RegExp(`${prefix?.replace(/[[\]]/g, "\\$&")}(\\d+)\\]`).exec(
        reportMarker(12),
      )?.[1],
    ).toBe("12");
  });
});

describe("points d'extension", () => {
  test("test_portail_identique_a_AppShell", async () => {
    const shell = readFileSync("src/app/AppShell.tsx", "utf8");
    const { FEATURE_PORTAL_ID } =
      await import("@/features/rehearsal/LocalDialog");
    expect(/FEATURE_PORTAL_ID = "([^"]+)"/.exec(shell)?.[1]).toBe(
      FEATURE_PORTAL_ID,
    );
  });
});

describe("machine d'états", () => {
  test.each([
    ["speech", ["current", "todo", "todo"]],
    ["qa", ["done", "current", "todo"]],
    ["analysis", ["done", "done", "current"]],
    ["report", ["done", "done", "current"]],
  ] as const)("test_stepStates_%s", (phase, states) => {
    expect(stepStates(phase)).toEqual(states);
  });

  test("test_libelles_et_visionneuse_par_phase", () => {
    expect(NEXT_LABEL).toEqual({
      speech: "J'ai terminé mon discours",
      qa: "Voir le rapport",
      analysis: "Analyse en cours…",
      report: "Terminer",
    });
    expect(PHASES.map(slidesHidden)).toEqual([false, false, true, true]);
  });

  // Table de vérité : phase × lecture × discussion à la voix
  const cases = PHASES.flatMap((phase) =>
    [false, true].flatMap((reading) =>
      [false, true].map((talking) => ({ phase, reading, talking })),
    ),
  );
  test.each(cases)(
    "test_plugin_$phase_lecture_$reading_discussion_$talking",
    (state) => {
      expect(isActive(state)).toBe(
        state.phase !== "report" || state.reading || state.talking,
      );
      expect(isSilent(state)).toBe(
        state.phase === "speech" || state.phase === "analysis",
      );
      expect(holdsMic(state)).toBe(state.phase !== "speech");
    },
  );

  test("test_plugin_sans_repetition_inactif", () => {
    expect([isActive(null), isSilent(null), holdsMic(null)]).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("transcriptions et rapport", () => {
  test.each([
    ["Merci.", 0.5, "speech", true],
    ["Merci beaucoup.", 0.8, "qa", true],
    ["Merci beaucoup à tous.", 0.5, "speech", false],
    ["Hum", 1.5, "speech", false],
    ["Hum", 0.2, "report", false],
  ] as const)(
    "test_isFragment_%j_%s_s_%s",
    (text, seconds, phase, fragment) => {
      expect(isFragment(text, seconds, phase)).toBe(fragment);
    },
  );

  test("test_wordCount_espaces_multiples", () => {
    expect(wordCount("  un   deux\ttrois ")).toBe(3);
    expect(wordCount("")).toBe(0);
  });

  test.each([
    [{ score: 7, initial_score: null }, false],
    [{ score: 7 }, false],
    [{ score: 7, initial_score: 7 }, false],
    [{ score: 6, initial_score: 7 }, true],
  ])("test_revised_%j", (report, expected) => {
    expect(revised(report)).toBe(expected);
  });

  test("test_meterPosition_echelle_60_dB", () => {
    expect(meterPosition(0)).toBe(0);
    expect(meterPosition(1)).toBe(1);
    expect(meterPosition(0.001)).toBeCloseTo(0, 5);
    expect(meterPosition(0.1)).toBeCloseTo(2 / 3, 5);
  });

  test("test_formatDate_francais", () => {
    expect(formatDate(0)).toMatch(/1970/);
  });
});
