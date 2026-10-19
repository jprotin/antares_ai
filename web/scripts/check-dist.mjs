// Contrôle du build (plan 2.1, TASK-28), lancé par `npm run build` :
// - aucun script ni style en ligne dans le HTML, aucun attribut style= ou on*= ;
// - aucune URL data: (le build garde les ressources en fichiers, assetsInlineLimit 0) ;
// - toute URL absolue http(s) figure dans scripts/url-allowlist.txt ;
// - le worklet du micro est copié tel quel depuis frontend/ (hors bundle, non haché).
//   node scripts/check-dist.mjs [dist]
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_URL = /\bdata:[a-z]+\/[a-z0-9.+-]+[;,]/i;
const ABSOLUTE_URL = /https?:\/\/[^\s"'`()<>\\]+/g;
// URL relatives au protocole (//cdn…) dans un attribut src/href ou un url() CSS
const PROTOCOL_RELATIVE =
  /(?:\b(?:src|href)\s*=\s*["']?|url\(\s*["']?)\/\/[a-z0-9.-]+\.[a-z]{2,}/gi;

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const sha256 = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

// Préfixes terminés par « / » : https://exemple.org ne couvre pas exemple.org.autre.tld
export function readAllowlist(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => (line.endsWith("/") ? line : `${line}/`));
}

export function checkHtml(html) {
  const problems = [];
  for (const [, attributes, body] of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
  )) {
    if (!/\bsrc=/i.test(attributes) || body.trim())
      problems.push("script en ligne");
  }
  if (/<style\b/i.test(html)) problems.push("balise <style>");
  if (/<[^>]+\sstyle\s*=/i.test(html)) problems.push("attribut style=");
  if (/<[^>]+\son[a-z]+\s*=/i.test(html)) problems.push("attribut on*=");
  return problems;
}

export function checkDist(dist, { allowlist, worklet }) {
  const problems = [];
  for (const path of files(dist)) {
    const name = relative(dist, path);
    if (!/\.(html|m?js|css|json|svg|txt|map|webmanifest)$/.test(name)) continue;
    const text = readFileSync(path, "utf8");
    if (name.endsWith(".html"))
      problems.push(...checkHtml(text).map((p) => `${name} : ${p}`));
    if (DATA_URL.test(text)) problems.push(`${name} : URL data:`);
    for (const [found] of text.matchAll(PROTOCOL_RELATIVE))
      problems.push(`${name} : URL relative au protocole ${found}`);
    for (const [found] of text.matchAll(ABSOLUTE_URL)) {
      // Ponctuation de fin de phrase (« …/marked. ») exclue de l'URL
      const url = found.replace(/[.,;:!?]+$/, "");
      const listed = allowlist.some(
        (prefix) => url === prefix.slice(0, -1) || url.startsWith(prefix),
      );
      if (!listed) problems.push(`${name} : URL hors liste ${url}`);
    }
  }
  const built = join(dist, "capture-worklet.js");
  if (worklet && existsSync(worklet)) {
    if (!existsSync(built)) problems.push("capture-worklet.js absent");
    else if (sha256(built) !== sha256(worklet))
      problems.push("capture-worklet.js différent de frontend/");
  }
  return [...new Set(problems)];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const web = fileURLToPath(new URL("..", import.meta.url));
  const dist = process.argv[2] ?? join(web, "dist");
  const problems = checkDist(dist, {
    allowlist: readAllowlist(join(web, "scripts/url-allowlist.txt")),
    // Référence : l'ancienne interface (absente de l'image Docker : contrôle sauté)
    worklet: existsSync(join(web, "public/capture-worklet.js"))
      ? join(web, "../frontend/capture-worklet.js")
      : "",
  });
  if (problems.length) {
    console.error(`check-dist : ${problems.length} problème(s)`);
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
  console.log("check-dist : OK");
}
