// Effets de lecture propres à une voix (voices.json : "effect"), reproduisant les filtres
// des extraits choisis à l'écoute (port de app.js) :
// - robot  : ffmpeg aecho=0.8:0.55:7:0.45,highpass=110,lowpass=6500,volume=1.1
// - cyborg : asetrate ×0.92 (plus grave et plus lent), aecho=0.8:0.6:4|9:0.4|0.25,
//            highpass=90, lowpass=4500, volume=1.2
// - metal  : aecho=0.8:0.7:2|4|6:0.55|0.4|0.3, highpass=180, lowpass=6500
// - rauque : volume=8dB,asoftclip=tanh,volume=-8dB, highpass=70 (voix rauque, sans
//            écho ni passe-bande : le métal et le mégaphone ont été écartés à l'écoute)

type Preset = {
  rate: number;
  inGain: number;
  outGain: number;
  echoes: [seconds: number, decay: number][];
  band: [highpass: number, lowpass: number];
  // Saturation douce (tanh) avant les échos : voix rauque
  drive?: number;
};

export const VOICE_EFFECTS: Record<string, Preset> = {
  robot: {
    rate: 1,
    inGain: 0.8,
    outGain: 0.55 * 1.1,
    echoes: [[0.007, 0.45]],
    band: [110, 6500],
  },
  cyborg: {
    rate: 0.92,
    inGain: 0.8,
    outGain: 0.6 * 1.2,
    echoes: [
      [0.004, 0.4],
      [0.009, 0.25],
    ],
    band: [90, 4500],
  },
  metal: {
    rate: 1,
    inGain: 0.8,
    outGain: 0.7,
    echoes: [
      [0.002, 0.55],
      [0.004, 0.4],
      [0.006, 0.3],
    ],
    band: [180, 6500],
  },
  rauque: {
    rate: 1,
    inGain: 1,
    outGain: 1,
    echoes: [],
    band: [70, 11500],
    drive: 10 ** (8 / 20),
  },
};

// Courbe tanh(drive·x) / drive : sature les crêtes, laisse le bas niveau intact
export function driveCurve(
  drive: number,
  points = 1024,
): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i += 1) {
    const x = (i / (points - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / drive;
  }
  return curve;
}

export type VoiceEffect = {
  // Vitesse de lecture (cyborg : ralentie, donc plus grave)
  rate: number;
  set(name?: string): void;
};

// Toutes les chaînes sont branchées une fois ; set() n'ouvre que celle de la voix
export function createVoiceEffect(
  ctx: BaseAudioContext,
  input: AudioNode,
  output: AudioNode,
): VoiceEffect {
  const gain = (value: number) => {
    const node = ctx.createGain();
    node.gain.value = value;
    return node;
  };
  const filter = (type: BiquadFilterType, frequency: number) => {
    const node = ctx.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    return node;
  };
  const dry = gain(1);
  input.connect(dry).connect(output);
  const chains: Record<string, GainNode> = {};
  for (const [name, preset] of Object.entries(VOICE_EFFECTS)) {
    const inGain = gain(preset.inGain);
    const mix = gain(preset.outGain);
    const on = gain(0);
    if (preset.drive) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = driveCurve(preset.drive);
      input.connect(shaper).connect(inGain);
    } else {
      input.connect(inGain);
    }
    inGain.connect(mix);
    for (const [seconds, decay] of preset.echoes) {
      const delay = ctx.createDelay(0.05);
      delay.delayTime.value = seconds;
      inGain.connect(delay).connect(gain(decay)).connect(mix);
    }
    mix
      .connect(filter("highpass", preset.band[0]))
      .connect(filter("lowpass", preset.band[1]))
      .connect(on)
      .connect(output);
    chains[name] = on;
  }
  const effect: VoiceEffect = {
    rate: 1,
    set(name) {
      const preset = name ? VOICE_EFFECTS[name] : undefined;
      dry.gain.value = preset ? 0 : 1;
      for (const [key, on] of Object.entries(chains)) {
        on.gain.value = key === name ? 1 : 0;
      }
      effect.rate = preset?.rate ?? 1;
    },
  };
  return effect;
}
