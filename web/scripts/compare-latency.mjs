// Verdict d'une série de latence ABAB (stratégie de tests, 7) :
//   node scripts/compare-latency.mjs tests/results/latency-<date>.json [seuil_bout_en_bout_ms] [seuil_client_ms]
// Échec si médiane B > médiane A + seuil (50 ms bout en bout, 5 ms segment client).
// p90 rapporté, signalé si l'écart dépasse 100 ms.
import { readFileSync } from "node:fs";

const [file, endToEndLimit = "50", clientLimit = "5"] = process.argv.slice(2);
const { A, B, series, failures } = JSON.parse(readFileSync(file, "utf8"));

function quantile(values, q) {
  const sorted = [...values].sort((x, y) => x - y);
  const index = (sorted.length - 1) * q;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function stats(measures, key) {
  const values = measures.map((m) => m[key]);
  return {
    n: values.length,
    median: quantile(values, 0.5),
    p90: quantile(values, 0.9),
  };
}

let failed = false;
console.log(`A = ${A}\nB = ${B}\néchecs : ${JSON.stringify(failures)}\n`);
for (const [key, limit] of [
  ["endToEnd", Number(endToEndLimit)],
  ["client", Number(clientLimit)],
]) {
  const a = stats(series.A, key);
  const b = stats(series.B, key);
  const delta = b.median - a.median;
  const ok = delta <= limit;
  failed ||= !ok;
  const p90Flag = b.p90 - a.p90 > 100 ? " (écart p90 > 100 ms)" : "";
  console.log(
    `${key.padEnd(9)} A médiane ${a.median.toFixed(1)} ms p90 ${a.p90.toFixed(1)} (n=${a.n}) | ` +
      `B médiane ${b.median.toFixed(1)} ms p90 ${b.p90.toFixed(1)} (n=${b.n}) | ` +
      `écart ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} ms, seuil +${limit} : ${ok ? "OK" : "ÉCHEC"}${p90Flag}`,
  );
}
process.exit(failed ? 1 : 0);
