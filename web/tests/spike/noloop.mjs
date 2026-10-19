// Micro simulé : le fichier repart-il au début à chaque getUserMedia avec %noloop ?
import { chromium } from "@playwright/test";
const wav = new URL("./beep.wav", import.meta.url).pathname;
const browser = await chromium.launch({
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}%noloop`,
  ],
});
const page = await (
  await browser.newContext({ permissions: ["microphone"] })
).newPage();
await page.goto("http://127.0.0.1:8766/");
const result = await page.evaluate(async () => {
  async function capture() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    const loud = [];
    const start = performance.now();
    while (performance.now() - start < 2500) {
      analyser.getFloatTimeDomainData(data);
      const rms = Math.sqrt(data.reduce((s, x) => s + x * x, 0) / data.length);
      if (rms > 0.05) loud.push(Math.round(performance.now() - start));
      await new Promise((r) => setTimeout(r, 50));
    }
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();
    return loud.length ? `son de ${loud[0]} à ${loud.at(-1)} ms` : "silence";
  }
  return [await capture(), await capture()];
});
console.log("1er getUserMedia :", result[0], "| 2e :", result[1]);
await browser.close();
