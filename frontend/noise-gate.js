// Filtre du bruit ambiant pendant une répétition : sous un seuil mesuré sur le bruit de
// la pièce, le micro envoie du silence au moteur. Un bruit de fond n'ouvre donc pas de
// tour de parole et n'est jamais transcrit. Le début et la fin des mots sont gardés
// (100 ms d'avance, 500 ms de maintien) ; le moteur reçoit le son avec 100 ms de retard.

// `factor` : seuil = bruit mesuré × factor ; `min` : seuil plancher (RMS, 0 à 1) ;
// `vad` : seuil de détection de parole du moteur (0,6 par défaut, cf. app.js)
export const NOISE_FILTERS = {
  light: { label: "Léger", factor: 2, min: 0.003, vad: 0.7 },
  normal: { label: "Normal", factor: 3, min: 0.006, vad: 0.8 },
  strong: { label: "Fort", factor: 4.5, min: 0.012, vad: 0.88 },
};
const MAX_THRESHOLD = 0.06;
const LOOKAHEAD_BLOCKS = 5;
const HOLD_BLOCKS = 25;
const STORAGE_KEY = "antares.noiseFilter";

// Niveau RMS (0 à 1) d'un bloc PCM16
function level(buffer) {
  const samples = new Int16Array(buffer);
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / (samples.length || 1)) / 32768;
}

export function storedFilter() {
  try {
    const name = window.localStorage.getItem(STORAGE_KEY);
    return name in NOISE_FILTERS ? name : "normal";
  } catch {
    return "normal";
  }
}

export function createNoiseGate() {
  let filter = NOISE_FILTERS[storedFilter()];
  // Bruit de la pièce (RMS), mesuré au calibrage
  let noise = 0;
  let calibration = null;
  let queue = [];
  let index = 0;
  let lastLoud = -Infinity;

  const gate = {
    name: storedFilter(),
    calibrated: false,
    level: 0,
    open: false,
    threshold: filter.min,

    setFilter(name) {
      if (!(name in NOISE_FILTERS)) return;
      gate.name = name;
      filter = NOISE_FILTERS[name];
      gate.threshold = Math.min(
        MAX_THRESHOLD,
        Math.max(filter.min, noise * filter.factor),
      );
      try {
        window.localStorage.setItem(STORAGE_KEY, name);
      } catch {
        // Réglage non mémorisé (stockage bloqué) : il vaut pour cette page
      }
    },

    vad: () => filter.vad,

    // Silence demandé pendant `ms` : le bruit de la pièce fixe le seuil
    calibrate(ms) {
      calibration = [];
      return new Promise((resolve) => {
        window.setTimeout(() => {
          const levels = calibration.sort((a, b) => a - b);
          calibration = null;
          // 80e centile : un bruit isolé pendant la mesure ne relève pas le seuil
          noise = levels[Math.floor(levels.length * 0.8)] ?? 0;
          gate.calibrated = true;
          gate.setFilter(gate.name);
          resolve(noise);
        }, ms);
      });
    },

    // Bloc capté -> blocs à envoyer (retardés de LOOKAHEAD_BLOCKS)
    filter(buffer) {
      gate.level = level(buffer);
      if (calibration) {
        calibration.push(gate.level);
        gate.open = false;
        return [new ArrayBuffer(buffer.byteLength)];
      }
      const current = index;
      index += 1;
      if (gate.level > gate.threshold) lastLoud = current;
      queue.push({ buffer, index: current });
      if (queue.length <= LOOKAHEAD_BLOCKS) return [];
      const oldest = queue.shift();
      gate.open = lastLoud >= oldest.index - HOLD_BLOCKS;
      return [
        gate.open ? oldest.buffer : new ArrayBuffer(oldest.buffer.byteLength),
      ];
    },

    reset() {
      queue = [];
      lastLoud = -Infinity;
      gate.open = false;
    },
  };
  return gate;
}
