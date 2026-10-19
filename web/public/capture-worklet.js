// Capture micro : convertit le flux en blocs PCM16 de 20 ms pour input_audio_buffer.append.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blockSize = Math.round(sampleRate * 0.02);
    this.buffer = new Int16Array(this.blockSize);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, channel[i]));
      this.buffer[this.filled] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this.filled += 1;
      if (this.filled === this.blockSize) {
        this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
        this.buffer = new Int16Array(this.blockSize);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
