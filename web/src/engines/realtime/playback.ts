// File de lecture de la réponse (port de enqueuePlayback / stopPlayback, app.js) : les
// morceaux PCM s'enchaînent sans trou, à la vitesse de l'effet de voix.
import { ECHO_TAIL_MS, SAMPLE_RATE } from "./protocol";
import type { VoiceEffect } from "./voiceEffects";

export class Playback {
  readonly sources = new Set<AudioBufferSourceNode>();
  private playhead = 0;
  // Fin de l'écho de la dernière lecture (le micro l'entend encore)
  quietUntil = 0;

  private readonly ctx: AudioContext;
  private readonly input: AudioNode;
  private readonly effect: VoiceEffect;
  // Appelé quand un morceau se termine (la file peut être vide)
  private readonly onDrained: () => void;

  constructor(
    ctx: AudioContext,
    input: AudioNode,
    effect: VoiceEffect,
    onDrained: () => void,
  ) {
    this.ctx = ctx;
    this.input = input;
    this.effect = effect;
    this.onDrained = onDrained;
  }

  get playing(): boolean {
    return this.sources.size > 0;
  }

  enqueue(samples: Float32Array) {
    const { ctx } = this;
    const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    // Effet « cyborg » : lecture ralentie, donc plus grave
    source.playbackRate.value = this.effect.rate;
    source.connect(this.input);
    const startAt = Math.max(ctx.currentTime + 0.03, this.playhead);
    source.start(startAt);
    this.playhead = startAt + buffer.duration / this.effect.rate;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (!this.sources.size)
        this.quietUntil = performance.now() + ECHO_TAIL_MS;
      this.onDrained();
    };
  }

  stop() {
    for (const source of this.sources) {
      source.onended = null;
      source.stop();
    }
    this.sources.clear();
    this.playhead = 0;
    this.quietUntil = performance.now() + ECHO_TAIL_MS;
  }
}
