# Bibliothèques tierces (copiées, non modifiées)

Servies localement : la politique de sécurité de la page (`script-src 'self'`) interdit
les scripts externes, et l'interface doit fonctionner hors ligne.

| Fichier                        | Bibliothèque                         | Version | Licence                   |
| ------------------------------ | ------------------------------------ | ------- | ------------------------- |
| `marked.esm.js`                | marked (Markdown → HTML)             | 18.0.14 | MIT                       |
| `purify.es.js`                 | DOMPurify (nettoyage du HTML)        | 3.4.16  | MPL-2.0 ou Apache-2.0     |
| `highlight.min.js`             | highlight.js, langages courants (ES) | 11.12.0 | BSD-3-Clause              |
| `languages/*.min.js`           | highlight.js : dockerfile, nginx, powershell | 11.12.0 | BSD-3-Clause      |
| `three/three.module.min.js`    | three.js (rendu 3D WebGL de l'avatar) | 0.160.1 | MIT                       |
| `three/RoomEnvironment.js`     | three.js, éclairage d'environnement  | 0.160.1 | MIT                       |

Seules modifications : retrait de la ligne `sourceMappingURL` (fichiers .map non fournis)
et `purify.es.mjs` renommé en `.js` (nginx sert `.mjs` sans type JavaScript) ;
`RoomEnvironment.js` importe `./three.module.min.js` au lieu de `three` (pas d'import map :
la CSP interdit les scripts en ligne). three.js 0.160 : dernière version livrée en un seul
fichier minifié.
Mise à jour : `npm pack <paquet>@<version>` puis recopier les mêmes fichiers.
