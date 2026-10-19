// Inventaire des licences des dépendances d'exécution (DI-6) : dist/THIRD-PARTY-LICENSES.txt.
// Informatif : n'échoue jamais le build (expressions SPDX reprises telles quelles).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
try {
  const packages = JSON.parse(
    execFileSync("npm", ["query", ".prod"], { cwd: web, encoding: "utf8" }),
  );
  const lines = [
    ...new Set(
      packages.map(
        (p) =>
          `${p.name}@${p.version} : ${typeof p.license === "string" ? p.license : JSON.stringify(p.license ?? "inconnue")}`,
      ),
    ),
  ].sort();
  writeFileSync(
    `${web}/dist/THIRD-PARTY-LICENSES.txt`,
    `Dépendances d'exécution de l'interface antares (${lines.length})\n\n${lines.join("\n")}\n`,
  );
  console.log(`licences : ${lines.length} paquets inventoriés`);
} catch (error) {
  console.warn(`licences : inventaire impossible (${error.message})`);
}
