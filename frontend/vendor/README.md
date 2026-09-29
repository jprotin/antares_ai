# Bibliothèques tierces (copiées, non modifiées)

Servies localement : la politique de sécurité de la page (`script-src 'self'`) interdit
les scripts externes, et l'interface doit fonctionner hors ligne.

| Fichier                        | Bibliothèque                         | Version | Licence                   |
| ------------------------------ | ------------------------------------ | ------- | ------------------------- |
| `marked.esm.js`                | marked (Markdown → HTML)             | 18.0.14 | MIT                       |
| `purify.es.js`                 | DOMPurify (nettoyage du HTML)        | 3.4.16  | MPL-2.0 ou Apache-2.0     |
| `highlight.min.js`             | highlight.js, langages courants (ES) | 11.12.0 | BSD-3-Clause              |
| `languages/*.min.js`           | highlight.js : dockerfile, nginx, powershell | 11.12.0 | BSD-3-Clause      |

Seules modifications : retrait de la ligne `sourceMappingURL` (fichiers .map non fournis)
et `purify.es.mjs` renommé en `.js` (nginx sert `.mjs` sans type JavaScript).
Mise à jour : `npm pack <paquet>@<version>` puis recopier les mêmes fichiers.
