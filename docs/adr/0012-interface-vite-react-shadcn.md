# 0012 — Interface web en Vite + React + shadcn/ui

- **Status** : accepted (2026-10-19, merge de `feature/interface-vite-react` dans develop)
- **Date** : 2026-10-19
- **Auteur(s)** : jprotin
- **Tags** : interface, frontend, CSP, build, tests

## Contexte

L'interface `frontend/` était écrite en HTML, CSS et JavaScript natifs, en modules ES
sans build (environ 10 200 lignes), avec des bibliothèques copiées dans `frontend/vendor/`.
nginx (`antares-web`) la sert en lecture seule avec la CSP
`default-src 'self'; connect-src 'self'; media-src 'self' blob:; style-src 'self'; script-src 'self'`.

L'état vivait dans le DOM, et chaque fonctionnalité gonflait des fichiers partagés :
la Répétition (ADR 0011) ajoutait 757 lignes à `style.css`, 228 à `index.html` et 97 à
`app.js`. La demande initiale visait shadcn/ui avec Next.js.

Contraintes : hors ligne après `install.sh`, portabilité local et cloud, aucun GPU
consommé par l'interface, API navigateur temps réel (AudioWorklet, Web Audio, WebSocket,
WebGL), contrats `/v1/realtime`, `/api/*`, `/voices/`, `/config.json` inchangés.

## Décision

1. **Vite + React 19 + shadcn/ui (Radix) + Tailwind 4, en TypeScript strict**, dans
   `web/`. Application monopage construite en fichiers statiques, servie par nginx :
   pas de serveur Node en production. Next.js est écarté : en export statique, il perd ce
   qui le distingue et ajoute des scripts en ligne incompatibles avec `script-src 'self'`.
2. **CSP inchangée** (décision du spike, porte G2) : aucun assouplissement de `style-src`.
   - `react-remove-scroll-bar` (qui injecte un `<style>`) est remplacé par un shim aux
     règles statiques (`web/src/shims/remove-scroll-bar/`, alias dans `vite.config.ts`).
   - Le Markdown des réponses perd ses attributs `style` et `on*` avant DOMPurify
     (`FORBID_ATTR: style` en plus des règles héritées) : zéro violation, même sur une
     réponse hostile (amélioration MD-3).
   - Thème posé avant le premier rendu par un script externe synchrone
     (`public/theme-init.js`) : plus de flash du thème clair (amélioration TH-2).
   - Composants exclus car ils injectent des styles : `select`, `sonner`, `toast`,
     `alert-dialog`, `scroll-area`, `drawer`, `sheet`, `chart`. Listes natives et
     `window.confirm` gardés.
   - Contrôles automatiques : `scripts/check-dist.mjs` (pas de script ni de style en
     ligne, pas d'URL `data:`, URL absolues listées) et règles eslint (pas de
     `setAttribute('style')`, HTML brut seulement dans `MarkdownView.tsx`).
3. **Architecture** : code impératif sans React dans `src/engines/` (appel temps réel,
   avatar three.js, réseau, thème), store Zustand unique, registre des fonctionnalités
   `src/app/features.ts`. Une fonctionnalité se branche par une entrée du registre
   (critère RF-6 vérifié deux fois : la Répétition entière, puis une fenêtre factice, ne
   modifient que `features.ts`, 2 lignes).
4. **CSS** : les classes de `frontend/style.css` sont reprises telles quelles dans des
   feuilles par fonctionnalité, toutes dans `@layer components` (contrôle automatique), et
   les valeurs du navigateur écrasées par le preflight de Tailwind (titres, police des
   contrôles, puces, interligne) sont rétablies. Résultat : rendu identique à l'ancienne
   interface (captures comparées à chaque lot ; PDF du rapport identique au pixel près).
5. **Build** : image Docker multi-stage (Node puis nginx, épinglés par digest,
   `npm ci --ignore-scripts`, lockfile versionné). Le service `web` de `compose.yaml`
   construit `web/` (image `antares/web`, empreinte `git rev-parse HEAD:web` dans
   `version.json`) ; CSP complétée par `frame-ancestors 'none'`, `base-uri 'none'`,
   `object-src 'none'`, `form-action 'self'` et `X-Frame-Options DENY`.
   Retour arrière en une commande : `./ui.sh legacy` sert `frontend/` par `nginx:1.29-alpine`
   sans construction (fonctionne sans l'image `antares/web`), `./ui.sh new` revient à la
   nouvelle interface et la reconstruit si elle est périmée. Le choix persiste dans `.env`
   (`COMPOSE_FILE`). Bascule faite le 2026-10-19, huit cas de retour arrière vérifiés.
6. **Parité prouvée par les tests** : la même suite Playwright vise l'ancienne interface
   (oracle) et la nouvelle, via un adaptateur par interface (`web/tests/adapters`), avec
   des gardes automatiques (aucune requête hors origine, aucune violation CSP, aucune
   erreur JS, aucune écriture non autorisée sur la vraie API). Grille : `web/tests/PARITY.md`.

## Résultats mesurés

| Mesure                                                                           | Ancienne         | Nouvelle         |
| -------------------------------------------------------------------------------- | ---------------- | ---------------- |
| Segment client (réponse reçue → lecture lancée), médiane                         | 0,6 ms           | 0,5 à 0,6 ms     |
| Bout en bout avec Claude, médiane (bruit de 211 ms entre deux séries identiques) | 3,2 à 3,9 s      | 3,2 à 3,5 s      |
| Rendu d'une réponse de 5 000 caractères, médiane                                 | 7,8 à 8,1 ms     | 10,2 à 10,5 ms   |
| Images par seconde, orbe et avatars 3D (swiftshader)                             | 60               | 60               |
| Contextes WebGL vivants après 10 changements d'avatar                            | plusieurs        | au plus 1        |
| Poids servi, brut et gzip                                                        | 1 221 Ko, 335 Ko | 1 390 Ko, 388 Ko |

Le seuil bloquant de latence est le segment client (+5 ms), seul segment que l'interface
contrôle : avec Claude, la mesure de bout en bout varie de 211 ms entre deux séries
identiques (décision de l'utilisateur, 2026-10-19). Le rendu Markdown dépasse le seuil
de +10 % de 2,3 ms, coût propre de React (le rendu Markdown lui-même est identique) :
exception accordée par l'utilisateur le 2026-10-19.

## Alternatives considérées

| Critère                       | Vanilla restructuré | Next.js export statique         | Next.js serveur        | **Vite + React + shadcn/ui** |
| ----------------------------- | ------------------- | ------------------------------- | ---------------------- | ---------------------------- |
| CSP `script-src 'self'`       | Compatible          | Incompatible (scripts en ligne) | Nonces, serveur requis | **Compatible**               |
| Composants                    | À construire        | shadcn/ui                       | shadcn/ui              | shadcn/ui                    |
| Proxy de dev WebSocket et SSE | Sans objet          | Indisponible en export          | Oui                    | Natif                        |
| Production                    | nginx               | nginx                           | Conteneur Node en plus | nginx                        |

## Conséquences

- Positives : état et rendu séparés, une fonctionnalité par répertoire, typage strict,
  278 tests unitaires et environ 80 scénarios Playwright, améliorations
  (CSP sans violation, pas de flash du thème, contextes WebGL libérés, formulaires
  refermés masqués, champs validés, erreurs affichées au lieu d'être perdues).
- Négatives : une chaîne npm (build à l'installation ou image construite), 14 à 16 % de
  poids servi en plus, 2 ms de plus sur le rendu des longues réponses écrites.
- Ancienne interface conservée jusqu'à deux semaines d'observation sans régression
  après la bascule, puis supprimée (sur Go).

## Références

- Pipeline `/feature` (spec, plan, tâches, spike, validation) : notes locales, non
  versionnées.
- `web/README.md` (architecture, règles CSS et CSP, points d'extension).
- `web/tests/PARITY.md` (grille de parité, exceptions, mesures).
