// dist/version.json : identifie l'interface servie (smoke, retour arrière)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const { name, version } = JSON.parse(
  readFileSync(`${web}/package.json`, "utf8"),
);
writeFileSync(
  `${web}/dist/version.json`,
  `${JSON.stringify(
    {
      name,
      version,
      commit: process.env.ANTARES_COMMIT ?? "dev",
      // Empreinte de web/ au commit (git rev-parse HEAD:web) : ui.sh détecte une image périmée
      rev: process.env.ANTARES_WEB_REV ?? "inconnu",
      ui: "next",
    },
    null,
    2,
  )}\n`,
);
