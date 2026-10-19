// Filtre du bruit (stratégie de tests, 3.2) : même table pour l'ancien et le nouveau module.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { noiseGateImplementations } from "./implementations";
import { installWindow, MemoryStorage } from "./setup-window";

// Bloc PCM16 de 20 ms à 24 kHz (480 échantillons) d'amplitude constante
function block(amplitude: number): ArrayBuffer {
  const samples = new Int16Array(480).fill(Math.round(amplitude * 32767));
  return samples.buffer;
}

function isSilence(buffer: ArrayBuffer): boolean {
  return new Int16Array(buffer).every((sample) => sample === 0);
}

describe.each(noiseGateImplementations)("noise gate ($name)", (impl) => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = installWindow() as MemoryStorage;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("test_filter_premiers_blocs_retenus_100ms_d_avance", () => {
    const gate = impl.createNoiseGate();
    for (let i = 0; i < 5; i += 1) expect(gate.filter(block(0.5))).toEqual([]);
    expect(gate.filter(block(0.5))).toHaveLength(1);
  });

  test("test_filter_conservation_ordre_et_nombre", () => {
    const gate = impl.createNoiseGate();
    const out = Array.from({ length: 40 }, () =>
      gate.filter(block(0.5)),
    ).flat();
    expect(out).toHaveLength(35);
  });

  test("test_filter_bloc_fort_maintien_500ms_puis_silence", () => {
    const gate = impl.createNoiseGate();
    const inputs = [block(0.5), ...Array.from({ length: 60 }, () => block(0))];
    const out = inputs.map((b) => gate.filter(b)).flat();
    // Le bloc fort, puis 25 blocs de maintien ouverts (silence d'origine), puis la porte se ferme
    expect(isSilence(out[0] as ArrayBuffer)).toBe(false);
    expect(gate.open).toBe(false);
    expect(out).toHaveLength(56);
    expect(out.every((b) => b.byteLength === 960)).toBe(true);
  });

  test("test_calibrate_silence_et_seuil_borne", async () => {
    vi.useFakeTimers();
    const gate = impl.createNoiseGate();
    const done = gate.calibrate(3000);
    for (let i = 0; i < 100; i += 1) {
      const out = gate.filter(block(0.004));
      expect(out).toHaveLength(1);
      expect(isSilence(out[0] as ArrayBuffer)).toBe(true);
      expect(gate.open).toBe(false);
    }
    vi.advanceTimersByTime(3000);
    const noise = await done;
    expect(noise).toBeCloseTo(0.004, 3);
    expect(gate.calibrated).toBe(true);
    expect(gate.threshold).toBeCloseTo(
      Math.min(0.06, Math.max(0.006, noise * 3)),
      6,
    );
  });

  test("test_calibrate_pic_isole_ne_releve_pas_le_seuil", async () => {
    vi.useFakeTimers();
    const gate = impl.createNoiseGate();
    const done = gate.calibrate(3000);
    for (let i = 0; i < 99; i += 1) gate.filter(block(0.002));
    gate.filter(block(0.9));
    vi.advanceTimersByTime(3000);
    expect(await done).toBeCloseTo(0.002, 3);
  });

  test("test_calibrate_sans_bloc_bruit_nul", async () => {
    vi.useFakeTimers();
    const gate = impl.createNoiseGate();
    const done = gate.calibrate(100);
    vi.advanceTimersByTime(100);
    expect(await done).toBe(0);
  });

  test.each([
    ["light", 0.7],
    ["normal", 0.8],
    ["strong", 0.88],
  ])("test_setFilter_%s_vad_et_persistance", (name, vad) => {
    const gate = impl.createNoiseGate();
    gate.setFilter(name);
    expect(gate.vad()).toBe(vad);
    expect(storage.getItem("antares.noiseFilter")).toBe(name);
  });

  test("test_setFilter_inconnu_ignore", () => {
    const gate = impl.createNoiseGate();
    gate.setFilter("inconnu");
    expect(gate.name).toBe("normal");
  });

  test("test_storedFilter_valeur_invalide_normal", () => {
    storage.setItem("antares.noiseFilter", "n'importe");
    expect(impl.storedFilter()).toBe("normal");
  });

  test("test_storedFilter_stockage_en_erreur_normal", () => {
    installWindow({
      getItem() {
        throw new Error("bloqué");
      },
      setItem() {
        throw new Error("bloqué");
      },
    });
    expect(impl.storedFilter()).toBe("normal");
    expect(() => impl.createNoiseGate().setFilter("strong")).not.toThrow();
  });

  test("test_reset_vide_la_file", () => {
    const gate = impl.createNoiseGate();
    for (let i = 0; i < 4; i += 1) gate.filter(block(0.5));
    gate.reset();
    for (let i = 0; i < 5; i += 1) expect(gate.filter(block(0.5))).toEqual([]);
  });
});
