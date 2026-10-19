// Conversions PCM16 little-endian <-> base64 du protocole realtime (port de app.js)

// Par tranches de 0x8000 octets : String.fromCharCode(...) dépasserait la pile au-delà
export function base64FromPcm(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function floatFromBase64Pcm(b64: string): Float32Array {
  const binary = atob(b64);
  const samples = new Float32Array(binary.length / 2);
  for (let i = 0; i < samples.length; i += 1) {
    const value =
      binary.charCodeAt(2 * i) | (binary.charCodeAt(2 * i + 1) << 8);
    samples[i] = (value >= 0x8000 ? value - 0x10000 : value) / 0x8000;
  }
  return samples;
}
