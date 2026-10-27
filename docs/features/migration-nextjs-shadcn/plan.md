# Plan final : migration du frontend vers Vite + React + shadcn/ui

**Feature** : `migration-nextjs-shadcn` (ADR-0012)
**Entrées** : `plan/plan.md` (plan initial), `plan/plan-challenge.md` (2 bloquants, 8 majeurs, 9 mineurs), `spec/analysis-final.md`, décisions de l'utilisateur du 2026-10-19, vérifications dans le code (`frontend/`, `deploy/s2s/compose.yaml`, `deploy/s2s/install.sh`, `frontend/render.js`).
**Contraintes permanentes** : GitFlow (`feature/*` depuis `develop`), aucun commit sans Go, `script-src 'self'` non négociable, `style-src` tranché par le spike, aucun modèle LLM en dur dans `compose.yaml`, Claude via le bridge (non touché).

---

## Décisions intégrées

| #     | Sujet             | Décision appliquée dans ce plan                                                                                                                                                                                                                                            |
| ----- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DI-1  | Menus déroulants  | Les 10 `<select>` natifs de `index.html` restent des `<select>` natifs, habillés en Tailwind (composant maison `ui/native-select.tsx`). Pas de Select Radix ni shadcn.                                                                                                     |
| DI-2  | Confirmations     | Les 8 appels à `window.confirm` sont conservés. Pas d'AlertDialog.                                                                                                                                                                                                         |
| DI-3  | Composants shadcn | shadcn pour Dialog, Button, Input, Textarea, Label, Checkbox, RadioGroup, Popover, Command, Badge, Separator ; Tabs seulement si la maquette en a besoin (l'interface actuelle n'a pas d'onglets).                                                                         |
| DI-4  | Notifications     | Aucune (pas de Sonner, pas de Toast). Les messages restent dans la conversation (`systemLine`).                                                                                                                                                                            |
| DI-5  | Outillage gardé   | Playwright (parité, CSP, hors ligne, latence, fuites), `npm ci --ignore-scripts` + lockfile versionné + image Node épinglée par digest, pre-commit (eslint, prettier, tsc). Vitest limité à la logique pure.                                                               |
| DI-6  | Outillage retiré  | Gate de licences bloquant (remplacé par un inventaire généré, informatif), script et contrôle de poids (remplacés par un relevé unique documenté au lot 7), changements nginx optionnels (cache, `include` des en-têtes : hors périmètre, `feature/*` séparée ultérieure). |
| DI-7  | Calendrier        | Spike **après** la soutenance et le merge de `feature/repetition` dans `develop`. Rien n'est lancé avant.                                                                                                                                                                  |
| DI-8  | Langage           | TypeScript `strict` ; `allowJs` uniquement pour les rendus three.js portés tels quels.                                                                                                                                                                                     |
| DI-9  | Latence           | Seuil +50 ms sur la médiane, N = 20 par interface, **plus** un segment client mesuré à part avec son propre seuil (cf. 6.3), appels alternés ancien/nouveau.                                                                                                               |
| DI-10 | Livraison         | Build Docker multi-stage pendant `install.sh` (pas d'artefact versionné).                                                                                                                                                                                                  |
| DI-11 | Nommage et état   | Répertoire `web/`, store Zustand (vanilla), port 8766 pour `web-next` pendant le développement, branche `feature/interface-vite-react` depuis `develop`.                                                                                                                   |
| DI-12 | Observation       | Deux semaines sans régression avant suppression de `frontend/`.                                                                                                                                                                                                            |

## Écarts avec le plan initial

| Zone                           | Plan initial                                               | Plan final                                                                                                                                                                           | Origine    |
| ------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| Select                         | `ui/select` (Radix) dans les lots 3 et 5                   | `<select>` natif habillé ; Select Radix exclu (il rend lui-même un `<style>` dans `SelectViewport`)                                                                                  | B1, DI-1   |
| Shim `react-remove-scroll-bar` | Alias Vite en chaîne                                       | Alias **regex** `/^react-remove-scroll-bar(\/.*)?$/` qui couvre aussi `/constants` ; options supplémentaires : feuilles constructibles, `<dialog>` natif                             | B1, M7     |
| Assouplissement CSP            | `style-src-elem 'unsafe-inline'` présenté comme minimal    | Ordre de préférence : correctif du code, puis feuille constructible, puis empreinte `sha256` d'un `<style>` statique, puis `'unsafe-inline'` sur `style-src-elem` en dernier recours | M7         |
| Grille de parité               | « Toutes les lignes auto vertes sur l'ancienne interface » | Colonne **portée** (parité / amélioration) ; lignes d'amélioration attendues KO sur l'ancienne ; adaptateurs de test par interface                                                   | B2         |
| Latence                        | Bout en bout seul, 20 puis 20                              | Bout en bout (seuil +50 ms) **et** segment client (premier `output_audio.delta` vers `start()`), appels alternés ABAB                                                                | M1         |
| RF-6                           | `git diff --stat` du commit de branchement                 | Diff de **tout le lot 6** hors `src/features/rehearsal/`, plus une fenêtre factice branchée puis retirée au lot 7                                                                    | M2         |
| CSS                            | Non spécifié                                               | Règle de transposition de `style.css` (utilitaires, CSS Modules, `@layer components`) et ordre des couches Tailwind v4                                                               | M3         |
| Retour arrière                 | Surcharge qui garde `image: antares/web`                   | Surcharge `image: nginx:1.29-alpine` + `build: !reset null` ; `COMPOSE_FILE` conservé par `install.sh` ; test des cas défavorables ; `version.json` vérifié par `ui.sh`              | M4, M5     |
| RF-7 après bascule             | `preview:nginx` dépend de `compose.web-next.yaml` supprimé | `preview:nginx` reciblé sur le service `web` (`docker compose up -d --build web`)                                                                                                    | M5         |
| Spike                          | L1 à L9 (grille et mesures comprises), 1,5 à 2 j           | L1 à L6 et L9 seulement, 1 à 1,5 j ; grille (L7) et mesures (L8) déplacées au lot 1                                                                                                  | M6         |
| Total                          | « 20,5 à 28 j plus le spike » (faux)                       | Lots 20,5 à 27,5 j, spike 1 à 1,5 j, **total 21,5 à 29 j-h** (détail en 5.2)                                                                                                         | M6         |
| Vite                           | `rollupOptions.output.manualChunks` objet                  | Vite 8 (Rolldown) épinglé : `manualChunks` en **fonction**                                                                                                                           | Mi1        |
| highlight.js                   | `lib/common`                                               | `lib/common` + `dockerfile`, `nginx`, `powershell` importés explicitement                                                                                                            | Mi2        |
| CSSOM                          | C1 sans réserve                                            | `setAttribute('style', ...)` et HTML injecté avec `style=` sont bloqués ; règle eslint ; `FORBID_ATTR: ['style']` dans DOMPurify                                                     | Mi3        |
| Licences et audit              | Gate bloquant sur expressions SPDX                         | Inventaire informatif ; `npm audit` complet (prod et dev) par commande documentée                                                                                                    | Mi4, DI-6  |
| `.gitignore`                   | `test-results/`, `playwright-report/`                      | + `web/tests/results/`                                                                                                                                                               | Mi5        |
| Garde hors ligne               | `context.route('**/*')` sur toute la suite                 | Observation `page.on('request')` / `on('websocket')` ; blocage seulement dans le projet `offline-strict`                                                                             | Mi6        |
| Spike sur la pile réelle       | `docker run` avec `ANTARES_*` en dur                       | Après la soutenance (DI-7) ; `compose.web-next.yaml` par `extends` dès le départ                                                                                                     | Mi7        |
| Impression                     | `body > :not(#root)` masqué                                | Rapport obligatoirement rendu dans `#root` (pas de Dialog) ; seuls visionneuse et fenêtres sont en portail                                                                           | Mi8        |
| Retour arrière niveau 2        | `git revert -m 1`                                          | Idem, avec « revert du revert » documenté avant reprise ; niveau 1 privilégié tant que `frontend/` existe                                                                            | Mi9        |
| Projet `firefox-mock`          | Prévu                                                      | Retiré ; remplacé par les lignes manuelles Firefox de la grille                                                                                                                      | M8         |
| nginx (4.5)                    | Cache `/assets/`, `no-cache`, `include` des en-têtes       | Hors périmètre ; CSP et gabarit inchangés sauf décision du spike                                                                                                                     | M8, DI-6   |
| Notifications, AlertDialog     | Points à confirmer                                         | Tranchés : aucun                                                                                                                                                                     | DI-2, DI-4 |

Écarts avec la spec (`analysis-final.md`) induits par les décisions de l'utilisateur, à consigner dans l'ADR-0012 :

- RNF-4 : l'inventaire des licences n'est plus bloquant (informatif) ;
- RF-4 : les sélecteurs natifs et `window.confirm` restent hors shadcn, et il n'y a pas de notification ;
- livrable 1 du spike : la page témoin ne contient ni Select Radix ni toast, puisqu'ils sont exclus d'office.

---

## 0. Constats de l'exploration qui pèsent sur le plan

| #   | Constat (fichier)                                                                                                                                                                                                                                                                                      | Conséquence                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | La CSP `style-src 'self'` bloque les balises `<style>` injectées, les attributs `style="..."` venus du HTML, **et** `el.setAttribute('style', ...)`. Elle ne bloque pas les écritures CSSOM (`el.style.setProperty`, `el.style.x = ...`), qu'utilisent déjà `theme.js`, `picker.js` et `rehearsal.js`. | La prop React `style={{...}}` passe par le CSSOM : autorisée. Interdits : `setAttribute('style')` dans les moteurs portés (règle eslint, cf. 3.4), et tout HTML injecté contenant `style=` (DOMPurify `FORBID_ATTR: ['style']`, cf. 2.8). Bibliothèques fautives connues : `react-remove-scroll-bar` via `react-style-singleton` (Dialog, Popover modal), le `<style>` de `SelectViewport` (Select Radix, exclu), Sonner (exclu), `ScrollArea` (exclu). |
| C2  | `default-src 'self'` sert de règle pour `img-src` et `font-src`. Vite transforme par défaut les petits fichiers en URI `data:`.                                                                                                                                                                        | `build.assetsInlineLimit: 0`, plus un contrôle du build (`check-dist.mjs`).                                                                                                                                                                                                                                                                                                                                                                             |
| C3  | Aucun script anti-flash aujourd'hui : `<meta name="color-scheme" content="dark">` et `theme.js` en module différé.                                                                                                                                                                                     | `public/theme-init.js`, script classique externe et synchrone. La ligne « absence de flash » est une **amélioration** (KO attendu sur l'ancienne interface).                                                                                                                                                                                                                                                                                            |
| C4  | Tous les appels réseau utilisent des URL relatives (`api/...`, `config.json`, `voices/...`, `capture-worklet.js`).                                                                                                                                                                                     | `base: './'` ; worklet chargé via `new URL('./capture-worklet.js', document.baseURI)`.                                                                                                                                                                                                                                                                                                                                                                  |
| C5  | `app.js` mesure une latence (`speech_stopped` vers premier `output_audio.delta`), mais pas jusqu'à `AudioBufferSourceNode.start`.                                                                                                                                                                      | Mesure externe par script injecté par Playwright, identique pour les deux interfaces (cf. 6.3).                                                                                                                                                                                                                                                                                                                                                         |
| C6  | `install.sh` (`ensure_tokens`) réécrit `.env` entièrement avec une liste fermée de clés (il conserve déjà `NGROK_AUTHTOKEN`, `SEARXNG_SECRET`, `RAG_INTEGRATED_TOKEN`, `COMPOSE_PROFILES`).                                                                                                            | Ajouter `COMPOSE_FILE` à la liste conservée, sur le même schéma que `COMPOSE_PROFILES`.                                                                                                                                                                                                                                                                                                                                                                 |
| C7  | Le réseau `antares-local` est `internal`.                                                                                                                                                                                                                                                              | `web-next` est sur `antares-edge` (port publié) et `antares-local`, comme `web`.                                                                                                                                                                                                                                                                                                                                                                        |
| C8  | Le `.gitignore` racine ignore `vendor/`, `build/`, `dist/`, `out/`, `env/`, `bin/`, `target/`, `coverage/`.                                                                                                                                                                                            | Aucun répertoire de `web/src` ne porte ces noms. Ajouter `web/test-results/`, `web/playwright-report/` et `web/tests/results/`.                                                                                                                                                                                                                                                                                                                         |
| C9  | Dans nginx, un `add_header` de `location` annule ceux du `server` (déjà le cas pour `/voices/` et `/config.json`).                                                                                                                                                                                     | Constat noté pour la `feature/*` nginx ultérieure ; rien n'est changé ici (DI-6).                                                                                                                                                                                                                                                                                                                                                                       |
| C10 | Le README recommande Firefox ; Playwright ne simule un micro par fichier WAV que sous Chromium.                                                                                                                                                                                                        | Tests automatiques sous Chromium ; lignes manuelles Firefox dans la grille (appel réel, fenêtres, CSP en console).                                                                                                                                                                                                                                                                                                                                      |
| C11 | 8 appels à `window.confirm` (agents, connexions, services, knowledge, ragprojects, rehearsal).                                                                                                                                                                                                         | Conservés (DI-2) ; Playwright les gère par `page.on('dialog')`.                                                                                                                                                                                                                                                                                                                                                                                         |
| C12 | Fenêtres créées à la volée dans `rehearsal.js` (visionneuse, rapport) ; impression fondée sur `body:has(.app[data-rehearsal="report"])`.                                                                                                                                                               | Le rapport est rendu dans `#root` ; seuls visionneuse et fenêtres utilisent un portail, masqué à l'impression (cf. 2.6).                                                                                                                                                                                                                                                                                                                                |
| C13 | 10 `<select>` natifs dans `index.html`.                                                                                                                                                                                                                                                                | `ui/native-select.tsx` ; les tests `selectOption` restent valables sur les deux interfaces.                                                                                                                                                                                                                                                                                                                                                             |
| C14 | `render.js` enregistre `dockerfile`, `nginx` et `powershell` en plus du jeu courant ; DOMPurify : `FORBID_TAGS: ["style", "form", "input", "img"]`, pas de `FORBID_ATTR`.                                                                                                                              | `markdown.ts` importe ces trois langues explicitement ; ajout de `FORBID_ATTR: ['style']` (rendu identique, puisque la CSP bloque déjà l'attribut, mais plus de violation remontée).                                                                                                                                                                                                                                                                    |
| C15 | Le service `web` actuel : `image: nginx:1.29-alpine`, montage de `../../frontend`, valeurs `ANTARES_*` via les ancres `*stt`, `*tts`, `*tts-quantization`. Docker Compose v5.6 installé (supporte `!reset` et `!override`).                                                                            | Les surcharges utilisent `extends` et `!override` au lieu de recopier les valeurs `ANTARES_*`.                                                                                                                                                                                                                                                                                                                                                          |

---

## 1. Phase 0 : spike go/no-go (1 à 1,5 jour)

### 1.0 Préalables

- Soutenance passée, `feature/repetition` mergée dans `develop` (DI-7). Aucune action du spike avant.
- Versions épinglées dès l'ossature : Vite 8.x exact (Rolldown), CLI `shadcn@<version exacte>`, `@tailwindcss/vite`, React 19.x. Elles sont notées dans `spike-report.md`.

### 1.1 Mise en place

```bash
cd /datadisk/ai-projects/antares_ai
git checkout develop && git pull
git worktree add ../antares_ai-spike -b spike/vite-shadcn develop   # branche jetable, jamais mergée
cd ../antares_ai-spike
npm create vite@<version épinglée> web -- --template react-ts
```

La pile s2s tourne sur `127.0.0.1:8765`. La page témoin est servie par `web-next` sur `127.0.0.1:8766` (`compose.web-next.yaml`, cf. 4.3), jamais par un `docker run` avec des valeurs en dur. Aucun commit sans Go, y compris sur la branche jetable.

### 1.2 Livrables (décision seulement)

Stockés en local dans `.claude/features/migration-nextjs-shadcn/spike/`, ignoré par git.

| #   | Livrable                   | Contenu                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | Page témoin                | `web/src/App.tsx` : `Dialog` (formulaire, Échap, clic extérieur, focus rendu), `native-select` habillé, `Popover` + `Command` (préfiguration du sélecteur d'agent : recherche, groupes, clavier), `RadioGroup`, `Checkbox`, bouton déclenchant `window.confirm`, bascule de thème auto/sombre/clair avec `public/theme-init.js`, `--hue` modifiée en CSSOM, bloc Markdown (marked + DOMPurify + highlight.js avec un bloc `nginx`), canvas three.js 0.160.1 minimal, bouton « Test WS » (`/v1/realtime`, `session.update`, attente de `session.updated`) et bouton « Test SSE » (`POST /api/chat` lu en flux). |
| L2  | Service sous le vrai nginx | `npm run build`, puis `web-next` avec une copie locale du gabarit qui ajoute seulement `'report-sample'` (cf. 1.3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| L3  | `csp-report.md`            | Une ligne par violation : directive (`effectiveDirective`), source (fichier, bibliothèque, ligne, échantillon), nature (`<style>` injecté, attribut `style`, script, `data:`), composant déclencheur, correctif essayé, résultat, coût.                                                                                                                                                                                                                                                                                                                                                                        |
| L4  | `csp-concessions.md`       | Si une violation résiste : ce qu'il faudrait céder, limité à `style-src`, dans l'ordre de préférence de 1.4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| L5  | Boucle de dev              | `vite.config.ts` avec le proxy (cf. 3.1). Un appel WebSocket et un flux SSE fonctionnent depuis `http://127.0.0.1:5173`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| L6  | Maquette et règle CSS      | Captures (sombre et clair) de l'écran d'appel et de la fenêtre Réglages, refaites avec les variables actuelles de `style.css` reportées dans les jetons shadcn, **en appliquant la règle CSS de 2.9** (au moins un bloc en utilitaires, un CSS Module, un bloc en `@layer components`). Soumises à l'utilisateur : fidélité visuelle et règle CSS validées ensemble.                                                                                                                                                                                                                                           |
| L9  | `spike-report.md`          | Décision proposée (table 1.5), versions épinglées, vérification `--ignore-scripts` (esbuild, lightningcss, oxide Tailwind), vérification de `%noloop` sur le micro simulé (un essai, pas de banc), estimation révisée, ce qui est gardé et jeté (1.6).                                                                                                                                                                                                                                                                                                                                                         |

La grille de parité (ancien L7) et les mesures de référence (ancien L8) sont faites **une seule fois, au lot 1** (cf. 5.1), conformément au livrable 6 de la spec, déplacé du spike vers le premier lot : elles ne conditionnent pas le go/no-go, qui porte sur la CSP, la boucle de dev et la maquette.

Découpage indicatif : J1 matin, ossature, shadcn et page témoin ; J1 après-midi, build, `web-next`, relevé CSP et correctifs ; J2 matin (si nécessaire), maquette, règle CSS, rapport et présentation du go/no-go.

### 1.3 Mesure des violations CSP sous le vrai nginx

- `compose.web-next.yaml` du spike monte une **copie locale** du gabarit avec `'report-sample'` ajouté à `style-src` et `script-src` (cela ne relâche rien et fournit les 40 premiers caractères du code bloqué).
- Test Playwright `web/tests/spike/csp.spec.ts`, `bypassCSP: false` :
  - `page.addInitScript` installe un écouteur `securitypolicyviolation` qui empile `{effectiveDirective, blockedURI, sourceFile, lineNumber, sample}` dans `window.__csp` ;
  - `page.on('console')` capture les messages « Content Security Policy » ;
  - scénario : chargement en thème clair enregistré, Dialog ouvert et fermé (Échap puis clic extérieur), `native-select`, Popover et Command, `confirm`, trois bascules de thème, Markdown (dont un bloc avec `style=`), canvas three.js ;
  - `web/tests/spike/csp-report.mjs` produit le tableau de L3.
- Vérification manuelle sous Firefox (console), notamment pour les feuilles constructibles si elles sont essayées.

### 1.4 Correctifs à essayer (time-box de 2 jours d'effort au plus, sinon arbitrage)

Ordre de préférence imposé : (1) correctif du code ; (2) feuille constructible ; (3) empreinte `sha256` d'un `<style>` statique ; (4) `style-src-elem 'self' 'unsafe-inline'` en dernier recours.

| Source                                                                                                 | Correctif                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react-remove-scroll-bar` (via `react-style-singleton`), utilisé par Dialog (et Popover en mode modal) | (1a) Alias Vite **regex** : `resolve.alias: [{ find: /^react-remove-scroll-bar(\/.*)?$/, replacement: <chemin absolu>/src/shims/remove-scroll-bar$1 }]`, le shim fournissant `index.tsx` (`RemoveScrollBar`, `zeroRightClassName`, `fullWidthClassName`, `noScrollbarsClassName`, `removedBarSizeVariable`) **et** `constants.ts` (importé par `react-remove-scroll/UI.js`). Le blocage du défilement passe par le CSSOM (`document.body.style.overflow`, compensation de la barre par `style.paddingRight`). (1b) Variante : `ui/dialog.tsx` à l'API shadcn adossé au `<dialog>` natif (Échap, piège à focus et inertie natifs). (2) Variante : alias de `react-style-singleton` vers un shim qui écrit dans un `new CSSStyleSheet()` ajouté à `document.adoptedStyleSheets` ; à valider sous Chromium **et** Firefox (aucune violation, compensation de barre conservée). |
| Select Radix (`<style>` dans `SelectViewport`)                                                         | Non utilisé (DI-1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Popover                                                                                                | Utilisé en mode non modal (`modal={false}`, valeur par défaut) : pas de `RemoveScroll`. À confirmer par le relevé.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Sonner, Toast                                                                                          | Non utilisés (DI-4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `ScrollArea` de Radix                                                                                  | Liste noire ; défilement natif.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| URI `data:` (polices, SVG)                                                                             | `assetsInlineLimit: 0` ; icônes en SVG dans le JSX ; contrôle `check-dist.mjs`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Attribut `style=` dans le Markdown                                                                     | `FORBID_ATTR: ['style']` dans DOMPurify.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Vaul (Drawer, Sheet)                                                                                   | Non utilisé.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Si une empreinte est retenue (option 3) : `style-src 'self'` reste, et `style-src-elem 'self' 'sha256-<...>'` est ajouté ; `check-dist.mjs` (ou un test Vitest) recalcule l'empreinte depuis le paquet verrouillé et échoue si elle diverge du gabarit. Toute option 2 à 4 est décidée et justifiée dans l'ADR-0012.

### 1.5 Table de décision (spec, appliquée telle quelle)

| Résultat du spike                                                                                                     | Décision                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Zéro violation avec la CSP actuelle                                                                                   | Go, CSP inchangée                                                                                                                  |
| Violations sur `style-src` seulement, supprimables par correctif du code (options 1 ou 2) en 2 jours d'effort au plus | Go, CSP inchangée, composants adaptés (shim, feuille constructible ou `<dialog>` natif, notés dans l'ADR)                          |
| Violations sur `style-src` seulement, impossibles à supprimer par le code                                             | Arbitrage de l'utilisateur : empreinte (option 3), puis `style-src-elem 'unsafe-inline'` (option 4), justifié dans l'ADR, ou no-go |
| Au moins une violation `script-src` sans correctif dans le code                                                       | No-go : on reste sur l'interface actuelle (repli : vanilla restructuré)                                                            |
| Boucle de dev ou proxy WebSocket/SSE non fonctionnel                                                                  | No-go jusqu'à résolution                                                                                                           |

### 1.6 Ce qui est gardé et ce qui est jeté

- **Gardé** (recopié par `git checkout spike/vite-shadcn -- <chemins>` sur `feature/interface-vite-react`, après Go) : `web/vite.config.ts`, `web/src/shims/` s'il est validé, `web/public/theme-init.js`, `web/src/components/ui/native-select.tsx`, `web/tests/support/csp-collector.ts`, ossature de `web/Dockerfile` et `deploy/s2s/compose.web-next.yaml` (avec le gabarit **réel**), la règle CSS validée, la liste des composants shadcn retenus et la liste noire.
- **Jeté** : la page témoin, le code de la maquette (les captures restent comme référence visuelle), la copie du gabarit avec `'report-sample'`, la branche `spike/vite-shadcn` et son worktree (`git worktree remove`), supprimés après la recopie (sur Go, la branche n'étant pas mergée).

---

## 2. Architecture cible de `web/`

### 2.1 Arborescence

```
web/
  package.json, package-lock.json, .nvmrc (24), .npmrc (engine-strict=true, fund=false)
  index.html                      # <script src="./theme-init.js"> en tête ; aucun script ni style en ligne
  vite.config.ts, vitest.config.ts, playwright.config.ts
  tsconfig.json, tsconfig.app.json, tsconfig.node.json
  eslint.config.js, .prettierrc.json, .prettierignore, components.json (shadcn)
  Dockerfile, .dockerignore, README.md
  public/
    capture-worklet.js            # copié tel quel depuis frontend/, hors bundle, non haché
    theme-init.js                 # anti-flash, script classique synchrone
  scripts/
    check-dist.mjs                # pas de script ou de style en ligne, pas de data:, URL https?:// listées, empreintes éventuelles
    url-allowlist.txt             # ex. http://www.w3.org/2000/svg, https://react.dev/errors/
    licenses-inventory.mjs        # npm query ".prod" -> dist/THIRD-PARTY-LICENSES.txt (informatif, n'échoue jamais)
    compare-latency.mjs           # médianes, p90, écarts, verdict (bout en bout et segment client)
  src/
    main.tsx                      # import de globals.css EN PREMIER (ordre des couches), createRoot + <StrictMode>
    app/
      App.tsx, AppShell.tsx       # grille scène / conversation / panneau de fonctionnalité
      features.ts                 # REGISTRE : seul fichier partagé touché pour brancher une fonctionnalité
      DialogHost.tsx, Toolbar.tsx # rendent ce que déclare le registre
    components/
      ui/                         # shadcn copiés et versionnés (button, dialog, input, textarea, label,
                                  # checkbox, radio-group, popover, command, badge, separator)
                                  # + native-select.tsx (maison)
      icons.tsx                   # SVG actuels de index.html, en composants
    shims/                        # seulement si validé au spike (remove-scroll-bar/{index,constants})
    lib/
      api.ts                      # getJson, sendJson, erreurs HTTP (HTTP_ERRORS), URL relatives
      sse.ts                      # lecture du flux /api/chat (logique de writtenReply)
      markdown.ts                 # marked + DOMPurify (mêmes hooks, + FORBID_ATTR style) + highlight.js
                                  # lib/common + dockerfile, nginx, powershell
      storage.ts                  # mêmes clés : antares-theme, antares-avatar, antares.noiseFilter
      persona.ts                  # instructionsFor, writtenInstructionsFor (repris de settings.js)
      pcm.ts                      # base64FromPcm, floatFromBase64Pcm
      cn.ts
    engines/                      # IMPÉRATIF, sans React (règle eslint)
      realtime/
        CallEngine.ts, voiceEffects.ts, playback.ts, protocol.ts, plugins.ts
      audio/noiseGate.ts
      avatar/
        AvatarHost.ts
        renderers/orb.js, face3d.js, avatars3d/{base,bender,visor}.js  # portés quasi tels quels
        renderers/types.d.ts
      net/netMonitor.ts
      theme/theme.ts
      registry.ts
    state/
      store.ts, slices/{profile,conversation,call,ui}.ts, hooks.ts
    hooks/
      useEngine.ts, useAvatarMount.ts, useTheme.ts, useRafThrottled.ts
    features/
      call/         CallStage, CallButton, StatusHeader, ModelInfo, HalfDuplexToggle, AvatarCanvas
      pickers/      AgentPicker, ModePicker (Popover non modal + Command, pastilles --item-hue)
      conversation/ ConversationPanel, MessageLine, MarkdownView, Composer, WebSources, Tags
      attachments/  AttachmentList, useAttachments, DropZone
      net/          NetIndicator
      theme/        ThemeToggle
      settings/     index.ts, SettingsDialog, AvatarOptions, VoicePreview, ModelOptions, ProjectOptions
      connections/  index.ts, ConnectionsDialog, ProviderForm, FallbackModel, services/{Rag,Search,Claude,Mcp}Section
      agents/       index.ts, AgentsDialog, AgentForm
      knowledge/    index.ts, KnowledgeEditDialog, KnowledgePanelDialog
      rag-projects/ index.ts, RagProjectsDialog
      rehearsal/    index.ts, RehearsalSetupDialog, RehearsalPanel, SlideViewer, Report/, Discussion,
                    MicMeter, rehearsalMachine.ts, rehearsalPlugin.ts, Rehearsal.module.css, print.css
    styles/
      globals.css   # @import "tailwindcss"; @theme inline (jetons) ; :root et [data-theme] ; @property --hue
    types/api.ts
  tests/
    PARITY.md, baseline/legacy.json, fixtures/ (question-fr.wav < 1 Mo, slides.pdf, api/*.json, sse-5000.txt)
    adapters/ (legacy.ts, next.ts, index.ts)   # cf. 6.2
    support/ (latency.init.ts, offline-guard.ts, csp-collector.ts, leak-probe.ts, fps-probe.ts)
    e2e/ (*.spec.ts par famille de la grille), perf/ (latency.spec.ts, fps.spec.ts, markdown.spec.ts)
    unit/ (vitest : hueFor, sse, pcm, noiseGate, persona, recentHistory, rehearsalMachine)
    results/        # ignoré par git
```

### 2.2 Découpage de l'état

Inchangé par rapport au plan initial :

- Un store Zustand en mode vanilla (`zustand/vanilla`), seule bibliothèque d'état, lu et écrit hors de React par les moteurs, et lu dans React par `useStore(store, selector)`.
- Tranches `profile`, `conversation` (avec `recentHistory()`, `HISTORY_LIMIT`, `HISTORY_CHARS`), `call` (états discrets, `data-state` sur la racine), `ui`.
- Les données à haute fréquence (niveaux audio, vu-mètre, file de lecture, images de l'orbe) ne passent jamais par l'état React.
- Markdown en flux : `useRafThrottled(text)` puis `useMemo(renderMarkdown)`, même cadencement que `renderInto`.

### 2.3 Encapsulation du code impératif

Inchangée (CallEngine démarré uniquement par un clic, `CallPlugin` pour la Répétition, worklet dans `public/`, `noiseGate.ts`, AvatarHost avec `forceContextLoss` **ajouté**, `theme.ts`), avec deux précisions :

- Les rendus three.js et l'orbe portés n'utilisent que le CSSOM (`style.setProperty`, `style.x`) ; `setAttribute('style', ...)` est interdit par eslint (cf. 3.4).
- `forceContextLoss` est une amélioration : la ligne de grille correspondante est marquée « amélioration » (cf. 6.1).

Règle de frontière : `no-restricted-imports` interdit `react` et `@/features/*` dans `src/engines/**` ; une fonctionnalité n'importe une autre que par son `index.ts`.

### 2.4 Thème clair et sombre sans script en ligne

Inchangé : `public/theme-init.js` (lecture de `antares-theme` sous `try/catch`, résolution `auto`, pose de `data-theme` et du `meta color-scheme`) ; blocs `:root`, `[data-theme=dark]`, `[data-theme=light]` repris dans `globals.css`, avec un repli `@media (prefers-color-scheme: light) { :root:not([data-theme]) {...} }` ; jetons shadcn définis à partir des variables actuelles et reliés par `@theme inline` ; `@property --hue` et sa transition conservées ; suivi de l'OS par `media.change`.

### 2.5 Teinte par agent

Inchangé : `theme.setDomain(active?.domain)`, `--hue` en CSSOM, `setHue(hue - 222)` sur l'avatar, pastilles en `style={{'--item-hue': hue}}`, test unitaire `hueFor('Sécurité') === 246`.

### 2.6 Impression PDF du rapport

- Le rapport est rendu **dans `#root`**, dans le panneau de la Répétition, jamais dans un Dialog ni un portail. `RehearsalPanel` pose `data-rehearsal="report"` sur la racine de l'application.
- La visionneuse de slides et les fenêtres sont des portails Radix montés dans `body` : `print.css` contient `@media print { body > :not(#root) { display: none !important } }`, puis masque la barre, la discussion, le micro et les contrôles (reprise de `style.css`, lignes 2103 à 2160 et 2405 et suivantes).
- Le bouton « Imprimer / PDF » appelle `window.print()`.
- Vérification (lot 6) : `page.pdf()` sur un rapport simulé (fixture JSON issue d'une vraie répétition), comparé au PDF de référence produit au lot 1 par l'ancienne interface avec la même fixture ; capture par page (`pdftoppm`), différence visuelle, validation par l'utilisateur. Ligne de grille dédiée : impression avec la visionneuse ouverte (le PDF ne contient que le rapport).

### 2.7 Registre des fonctionnalités (critère RF-6)

`src/app/features.ts` déclare `features: FeatureDef[]`, avec `FeatureDef = { id, toolbar?, dialogs?, panel?, callPlugin? }`.

Vérification de RF-6 (correctif M2), en deux contrôles :

1. **Sur tout le lot 6** : `git diff --stat <base du lot 6>..<fin du lot 6> -- . ':!web/src/features/rehearsal/'` ne doit montrer que `web/src/app/features.ts` (moins de 10 lignes), sans `globals.css`, `index.html`, `CallEngine`, `plugins.ts`, `slices/*` ni `AppShell`. Toute modification nécessaire du socle (par exemple un point d'extension manquant dans `CallPlugin`) est faite **avant**, au lot 3 ou 5, dans un commit nommé comme tel, et le contrôle est noté dans `validation/final-report.md`.
2. **Fenêtre factice au lot 7** : `features/sample-window/` (un Dialog, un CSS Module, un bouton de barre) branchée par une ligne dans `features.ts`, diff mesuré (un seul fichier partagé, moins de 10 lignes), puis retirée. Rien n'est commité de cette fenêtre : le diff est relevé dans l'arbre de travail.

### 2.8 Markdown et sécurité du rendu

- `markdown.ts` reprend `renderMarkdown` à l'identique (`ADD_ATTR: ['target']`, `FORBID_TAGS: ['style', 'form', 'input', 'img']`, hook des liens externes « à vérifier ») et ajoute `FORBID_ATTR: ['style']`.
- highlight.js : `highlight.js/lib/common` + `registerLanguage('dockerfile' | 'nginx' | 'powershell')` importés explicitement.
- Le HTML ne passe par `dangerouslySetInnerHTML` que dans `MarkdownView.tsx` (règle eslint).

### 2.9 Stratégie de transposition de `style.css` (correctif M3)

Règle validée sur la maquette L6, écrite dans `web/README.md` :

| Cas                                                                                                         | Traitement                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mise en page et habillage simples (marges, grilles, couleurs à partir des jetons, états `hover` et `focus`) | Utilitaires Tailwind dans le JSX, jetons shadcn par défaut                                                                                            |
| CSS propre à une fonctionnalité (orbe, états de l'appel, rapport, vu-mètre, animations, `:has()`)           | `*.module.css` dans le répertoire de la fonctionnalité, contenu enveloppé dans `@layer components { ... }`                                            |
| Règles réellement globales (variables de thème, `@property --hue`, `body`, défilement)                      | `globals.css` seulement, dans `@layer base` ou au niveau des jetons                                                                                   |
| Impression                                                                                                  | `features/rehearsal/print.css` (dans le répertoire de la fonctionnalité), en `@layer components`, avec `!important` là où l'ancienne feuille en avait |

Piège Tailwind v4 : preflight et utilitaires vivent dans les couches `theme, base, components, utilities`. Tout CSS **hors couche** l'emporte sur tous les utilitaires, quelle que soit la spécificité. Règles :

- aucun CSS recopié hors couche (contrôle : un test Vitest ou un script lit `src/**/*.css` et échoue sur une règle de premier niveau hors `@layer`, `@property`, `@theme`, `@import` ou `@media print` enveloppant une couche) ;
- `globals.css` est importé en premier dans `main.tsx`, pour que l'ordre des couches déclaré par Tailwind s'applique aussi aux CSS Modules (les noms de couche sont globaux au document) ;
- transposition **par lot** : au début de chaque lot, inventaire des blocs de `style.css` concernés (plages de lignes) dans `PARITY.md`, cochés à mesure ; à la fin du lot 7, chaque bloc de `style.css` est soit transposé, soit marqué « obsolète » avec la raison.

---

## 3. Outillage

### 3.1 Vite (`web/vite.config.ts`, Vite 8 / Rolldown, version épinglée)

<!-- prettier-ignore -->
```ts
import { fileURLToPath } from "node:url";
const src = fileURLToPath(new URL("./src", import.meta.url));
const target = process.env.ANTARES_URL ?? "http://127.0.0.1:8765";
export default defineConfig({
 base: "./",
 plugins: [react(), tailwindcss()],
 resolve: {
  alias: [
   { find: "@", replacement: src },
   // seulement si validé au spike (couvre aussi react-remove-scroll-bar/constants) :
   {
    find: /^react-remove-scroll-bar(\/.*)?$/,
    replacement: `${src}/shims/remove-scroll-bar$1`,
   },
  ],
 },
 server: {
  host: "127.0.0.1",
  port: 5173,
  strictPort: true,
  proxy: {
   "/v1": { target, ws: true },
   "/api": { target }, // SSE sans tampon ni compression côté proxy (vérifié au spike)
   "/voices": { target },
   "/config.json": { target },
  },
 },
 build: {
  target: "es2022",
  assetsInlineLimit: 0,
  sourcemap: false,
  modulePreload: { polyfill: false },
  rolldownOptions: {
   // nom de l'option à confirmer sur la version épinglée (rollupOptions déprécié)
   output: {
    manualChunks: (id) =>
     id.includes("/node_modules/three/") ? "three" : undefined,
   },
  },
 },
});
```

`three` reste chargé au démarrage (parité) ; le chargement à la demande est hors périmètre.

Commandes (`package.json`) :

| Script           | Commande                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev`            | `vite` (pile lancée par `docker compose up -d` ; `http://127.0.0.1:5173`)                                                                                                                                                       |
| `build`          | `tsc -b && vite build && node scripts/check-dist.mjs && node scripts/licenses-inventory.mjs`                                                                                                                                    |
| `preview:nginx`  | Avant la bascule : `docker compose -f ../deploy/s2s/compose.yaml -f ../deploy/s2s/compose.web-next.yaml up -d --build web-next` (8766). Après la bascule : `../deploy/s2s/ui.sh new --build` (service `web` reconstruit, 8765). |
| `typecheck`      | `tsc -b` (les tsconfig du gabarit portent déjà `noEmit`)                                                                                                                                                                        |
| `lint`, `format` | `eslint --max-warnings=0 .`, `prettier --write .`                                                                                                                                                                               |
| `test`           | `vitest run`                                                                                                                                                                                                                    |
| `test:e2e`       | `playwright test` (variable `ANTARES_URL`)                                                                                                                                                                                      |
| `audit`          | `npm audit --audit-level=high` (prod **et** dev, le serveur Vite étant exposé en local ; en ligne, commande documentée, non bloquante pour le build)                                                                            |

### 3.2 TypeScript

`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `moduleResolution: bundler`, alias `@/*`. `allowJs: true`, `checkJs: false` **seulement** pour `src/engines/avatar/renderers/*.js` (environ 1 900 lignes three.js portées sans réécriture), avec `types.d.ts`. Conversion en TS hors périmètre.

### 3.3 Tailwind et shadcn hors ligne

- Tailwind v4 avec `@tailwindcss/vite` ; pile de polices système reprise de `style.css` ; aucune police téléchargée.
- shadcn : `npx shadcn@<version épinglée> init`, puis `add button dialog input textarea label checkbox radio-group popover command badge separator` (et `tabs` seulement si la maquette l'exige), **une seule fois, en ligne, au lot 2**. Fichiers de `src/components/ui/` et `components.json` versionnés. `native-select.tsx` est maison (un `<select>` natif avec les classes de `input`, flèche en SVG JSX).
- Liste noire (`web/README.md`) : `select`, `alert-dialog`, `sonner`, `toast`, `scroll-area`, `drawer`, `sheet`, `chart`.
- Dépendances d'exécution : `react`, `react-dom`, paquets Radix requis par les composants retenus, `cmdk`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `zustand`, `marked@18.0.14`, `dompurify@3.4.16`, `highlight.js@11.12.0`, `three@0.160.1` (versions de `vendor/README.md`).
- Inventaire des licences : `licenses-inventory.mjs` écrit `dist/THIRD-PARTY-LICENSES.txt` (nom, version, expression SPDX telle quelle, par exemple `(MPL-2.0 OR Apache-2.0)` pour DOMPurify). Informatif : il ne fait jamais échouer le build (DI-6).

### 3.4 eslint, prettier, pre-commit

- `web/eslint.config.js` (configuration plate) : `@eslint/js`, `typescript-eslint` (avec types), `eslint-plugin-react-hooks` (`recommended`), `eslint-plugin-react-refresh`, globals navigateur, surcharge `public/capture-worklet.js` (globals AudioWorklet). Règles :
  - `no-restricted-imports` (frontières) ;
  - `no-restricted-syntax` sur `JSXAttribute[name.name='dangerouslySetInnerHTML']`, désactivée seulement dans `MarkdownView.tsx` ;
  - `no-restricted-syntax` sur `CallExpression[callee.property.name='setAttribute'][arguments.0.value='style']` et sur l'affectation de `innerHTML` hors `lib/markdown.ts` ;
  - `eqeqeq`.
- `.pre-commit-config.yaml` :
  - hook `mirrors-eslint` existant limité à `files: ^frontend/.*\.js$` jusqu'à la suppression de `frontend/` ;
  - hook `mirrors-prettier` existant : `exclude: ^web/` ;
  - hooks `repo: local`, `language: system` (versions du lockfile) :
    - `web-prettier` : `bash -c 'cd web && npx --no-install prettier --write "${@#web/}"' --`, `files: ^web/` ;
    - `web-eslint` : `bash -c 'cd web && npx --no-install eslint --max-warnings=0 --fix "${@#web/}"' --`, `files: ^web/.*\.(ts|tsx|js)$` ;
    - `web-typecheck` : `npm --prefix web run typecheck`, `pass_filenames: false`, `files: ^web/` ;
  - pas de hook d'audit (commande documentée seulement) ;
  - si `detect-secrets` ou `gitleaks` signalent les hachages d'intégrité, exclure `^web/package-lock\.json$` de ces deux hooks ;
  - `hadolint` couvre `web/Dockerfile`.
- Objectif : moins de 20 s sur un changement courant, mesuré au lot 2.
- Prérequis du mainteneur : `npm --prefix web ci --ignore-scripts` une fois (dev), documenté dans `web/README.md`.

### 3.5 Playwright

`web/playwright.config.ts` :

- `baseURL: process.env.ANTARES_URL ?? "http://127.0.0.1:8765"` ; `workers: 1` (une seule session s2s : `session_limit_reached`).
- Projet `chromium-live` : `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`, `--use-file-for-fake-audio-capture=tests/fixtures/question-fr.wav%noloop`, `--use-angle=swiftshader`, `--enable-unsafe-swiftshader`, `--autoplay-policy=no-user-gesture-required` ; `permissions: ["microphone"]`.
- Projet `chromium-mock` : `/api/*` simulé par `page.route` (fixtures JSON) pour les fenêtres CRUD et le PDF ; les données réelles de `router-data` ne sont jamais touchées.
- Projet `offline-strict` : `context.route('**/*')` interrompt toute requête hors de `baseURL` ; utilisé pour le test hors ligne (6.5), **jamais** pour les mesures de performance.
- Pas de projet Firefox : lignes manuelles Firefox dans la grille (appel réel, une fenêtre, console CSP).
- Fixtures automatiques sur tous les projets :
  - `offline-guard.ts`, **non intrusive** : `page.on('request')` et `page.on('websocket')` enregistrent toute origine différente de `baseURL` ; échec si la liste n'est pas vide (aucune interception, donc cache et mesures inchangés) ;
  - `csp-collector.ts` : écouteur `securitypolicyviolation` ; échec à la moindre violation, sauf sur l'ancienne interface pour les lignes marquées « amélioration » (cf. 6.1).
- Fixture audio : question courte en français (environ 2 s de parole puis 2 s de silence), WAV PCM16 mono de moins de 1 Mo, générée une fois et versionnée.
- Navigateurs : `npx playwright install chromium` (en ligne, dev uniquement, hors `install.sh`).

---

## 4. Build et déploiement

### 4.1 `web/Dockerfile` (multi-stage)

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim@sha256:<digest> AS build      # glibc comme le poste
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund
COPY . .
ARG WEB_REV=inconnu
RUN npm run build && printf '{"rev":"%s"}\n' "$WEB_REV" > dist/version.json

FROM nginx:1.29-alpine@sha256:<digest>
COPY --from=build /app/dist /usr/share/nginx/html
```

- `.dockerignore` : `node_modules`, `dist`, `test-results`, `playwright-report`, `tests`.
- `--ignore-scripts` vérifié au spike (L9) ; tout paquet qui exigerait un script est justifié dans `web/README.md`.
- Digests relevés par `docker buildx imagetools inspect` et mis à jour volontairement.
- Le cache npm (`--mount=type=cache`) permet de reconstruire hors ligne tant qu'il est chaud.
- La configuration nginx reste **montée** (gabarit unique, variables `ANTARES_*`) : le retour arrière ne change que la racine HTML.
- `WEB_REV` = empreinte d'arbre git de `web/` (`git rev-parse HEAD:web`), calculée par `ui.sh` et `install.sh` ; elle permet de détecter une image périmée (cf. 4.3).

### 4.2 `compose.yaml` après bascule (service `web`)

```yaml
web:
  image: antares/web:latest
  build:
    context: ../../web
    args:
      WEB_REV: ${ANTARES_WEB_REV:-inconnu}
  container_name: antares-web
  # ... environment, depends_on, ports, networks inchangés
  volumes:
    - ./voices:/srv/voices:ro
    - ./nginx.conf.template:/etc/nginx/templates/default.conf.template:ro
```

Aucun modèle ajouté. `llm-router` et le bridge Claude ne changent pas. L'étiquette figée `1.0.0` est abandonnée (elle laissait croire à des versions successives) ; la traçabilité passe par `version.json`.

### 4.3 Surcharges compose et `ui.sh`

- `deploy/s2s/compose.web-next.yaml` (pendant le développement, supprimé à la bascule) :

  ```yaml
  services:
    web-next:
      extends: { file: compose.yaml, service: web } # reprend environment (ancres ANTARES_*), réseaux, depends_on
      image: antares/web-next:dev
      build: { context: ../../web }
      container_name: antares-web-next
      ports: !override ["127.0.0.1:8766:8765"]
      volumes: !override
        - ./voices:/srv/voices:ro
        - ./nginx.conf.template:/etc/nginx/templates/default.conf.template:ro
  ```

  `develop` et le service `web` actuel restent intacts (RNF-6).

- `deploy/s2s/compose.legacy-ui.yaml` (retour arrière, correctif M4) :

  ```yaml
  services:
    web:
      image: nginx:1.29-alpine # image déjà présente : aucune construction, fonctionne sans antares/web
      build: !reset null
      volumes:
        - ../../frontend:/usr/share/nginx/html:ro # fusionné par chemin cible
  ```

- `install.sh` (étape en ligne) fait aussi `docker pull nginx:1.29-alpine`, pour que le mode legacy fonctionne hors ligne sur un nouvel hôte.
- `deploy/s2s/ui.sh legacy|new [--build]` (shellcheck, shfmt) :
  - `legacy` : écrit `COMPOSE_FILE=compose.yaml:compose.legacy-ui.yaml` dans `.env` (`umask 077`, autres clés conservées), `docker compose up -d web`, puis vérifie `curl -fsS 127.0.0.1:8765/ | grep -q 'src="app.js"'` ;
  - `new` : retire `COMPOSE_FILE` de `.env`, calcule `ANTARES_WEB_REV=$(git rev-parse HEAD:web)`, compare au `rev` de `http://127.0.0.1:8765/version.json` ; si différent (ou `--build`, ou image absente), `docker compose build web` puis `up -d web` ; vérifie ensuite que `version.json` porte la bonne empreinte. Si `git status --porcelain web/` n'est pas vide, il le signale (l'empreinte ne couvre que le commité) ;
  - le choix persiste après un simple `docker compose up -d`.
- Après un `git pull` qui touche `web/`, la commande documentée est `./ui.sh new` (ou `docker compose up -d --build web` avec `ANTARES_WEB_REV` exporté) : le README le dit explicitement, puisque `docker compose up -d` seul ne reconstruit pas l'image.

### 4.4 `install.sh`

- `docker compose --profile rag-integre build` construit l'image `antares/web` pendant l'étape en ligne, sans Node sur l'hôte ; `install.sh` exporte `ANTARES_WEB_REV` avant.
- Modifications :
  1. `ensure_tokens` conserve `COMPOSE_FILE` s'il est présent (même schéma que `COMPOSE_PROFILES`) ;
  2. `docker pull nginx:1.29-alpine` (cf. 4.3) ;
  3. log « Construction de l'interface (npm, en ligne) » ;
  4. un échec du build de l'interface fait échouer l'installation avec un message clair (registre npm injoignable) qui indique, pendant la période d'observation, `./ui.sh legacy` comme repli manuel. Pas de bascule automatique. Le script reste idempotent.
- `check-local.sh` et `smoke-test.sh` inchangés et doivent passer ; le README précise qu'ils ne vérifient pas l'interface (Playwright s'en charge).
- Hors ligne ensuite : `docker compose up -d` ne reconstruit rien ; `--build` hors ligne seulement avec un cache npm chaud. Transfert vers une machine sans registre : `docker image save antares/web:latest | gzip`, puis `docker image load`.

### 4.5 CSP et nginx

- CSP inchangée, sauf décision du spike (option 3 ou 4 de 1.4), consignée dans l'ADR-0012.
- Aucun autre changement du gabarit nginx dans cette feature (cache `/assets/`, `no-cache` sur `index.html`, `include` des en-têtes de sécurité : `feature/*` séparée ultérieure, cf. C9).

---

## 5. Lots de migration ordonnés

Préalables : soutenance passée, `feature/repetition` mergée, Go sur le spike.

```bash
git checkout develop && git pull
git checkout -b feature/interface-vite-react      # équivalent de git flow feature start interface-vite-react
```

L'ancienne interface est gelée : correctifs urgents par `bugfix/*` depuis `develop`, reportés sur la branche de migration. Un commit par lot (ou sous-lot), chacun sur Go.

### 5.1 Lots

| Lot                          | Contenu                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Dépend de                    | Critères de fin                                                                                                                                                                                                                                                                    | Jours     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **1. Oracle de parité**      | `web/tests/PARITY.md` (grille unique, environ 30 parcours, colonne portée), adaptateurs `tests/adapters/{legacy,next}.ts`, suite Playwright écrite contre l'ancienne interface via les adaptateurs, `support/*` (latence avec segment client, garde hors ligne non intrusive, collecteur CSP, fuites, images par seconde), fixtures, `baseline/legacy.json` (bout en bout et segment client, N = 20 ; images par seconde ; Markdown 5 000 caractères), PDF de référence, relevé unique du poids servi par l'ancienne interface (brut et gzip, noté dans `PARITY.md`) | Spike                        | Lignes **parité** « auto » vertes sur l'ancienne interface ; lignes **amélioration** marquées KO attendu ; mesures de référence enregistrées ; PDF de référence validé par l'utilisateur                                                                                           | 2,5 à 3,5 |
| **2. Socle**                 | `web/` (Vite, TS, Tailwind, shadcn copiés, `native-select`, jetons et thème, `theme-init.js`, règle CSS et contrôle des couches), `lib/` (api, storage, markdown, persona, pcm, sse), store, registre `features.ts`, `AppShell` vide, `Dockerfile` avec `version.json`, `compose.web-next.yaml`, `check-dist.mjs`, inventaire des licences, eslint, prettier, hooks pre-commit, Vitest                                                                                                                                                                               | 1 (en partie parallélisable) | `npm run build` passe ; servi sur 8766 avec 0 violation CSP ; garde hors ligne verte ; pre-commit en moins de 20 s ; tests de thème (persistance, absence de flash, suivi de l'OS) verts                                                                                           | 2 à 3     |
| **3. Appel temps réel**      | `engines/realtime`, `engines/net`, `engines/theme`, orbe 2D via AvatarHost, écran d'appel (statut, six états, bouton, demi-duplex, informations du modèle), sélecteurs agent et mode (teinte), conversation (sous-titres, annotations, sources, code dit à l'oral, Markdown en flux, copier, mots-clés), saisie (envoyer, ajouter au contexte, Entrée), réponse écrite SSE, pièces jointes, indicateur réseau et partage, nouvelle conversation, profil et alignement voix-avatar. Points d'extension `CallPlugin` complets pour la Répétition (cf. 2.7)             | 2                            | Lignes « appel », « conversation », « pièces jointes », « réseau » vertes ; trames PCM16 de 20 ms (1 280 caractères base64) ; **les deux seuils de latence tenus** (6.3) ; 10 appels sans `AudioContext` ni WS orphelin ; Markdown 5 000 caractères pas plus lent que la référence | 4 à 5     |
| **4. Avatars 3D**            | face3d, visor, bender, base (imports npm), AvatarHost complet (remplacement du canvas, repli sans WebGL, `forceContextLoss`), choix mémorisé (`antares-avatar`)                                                                                                                                                                                                                                                                                                                                                                                                      | 3                            | Images par seconde à moins de 10 % sous la référence ; 10 changements d'avatar avec au plus 1 contexte WebGL vivant (ligne amélioration) ; repli vers l'orbe sans WebGL                                                                                                            | 2 à 3     |
| **5. Fenêtres**              | Réglages, Connexions (fournisseurs, test, repli, services RAG, recherche, Claude, MCP), Agents, Fiches, Projets du RAG intégré ; `<select>` natifs habillés ; `window.confirm` conservés ; transposition CSS des blocs concernés                                                                                                                                                                                                                                                                                                                                     | 3 (4 pour l'option d'avatar) | Lignes « fenêtres » vertes en mock (Chromium) et ligne manuelle Firefox ; RF-4 (Échap, clic extérieur, focus piégé, focus rendu) ; parcours en lecture seule sur la vraie API ; comportement ngrok vérifié (Claude et écriture RAG coupés, message)                                | 4,5 à 5,5 |
| **6. Répétition et PDF**     | `noiseGate`, `rehearsalMachine` (testée en unitaire), plugin d'appel, préparation et historique, panneau (étapes, horloge, slides et clavier, vu-mètre, filtre), questions, rapport dans `#root` (anneau, barres, annexes, lecture), discussion, visionneuse (portail), `print.css`, `Rehearsal.module.css`                                                                                                                                                                                                                                                          | 3, 5                         | RF-6 contrôle 1 (diff de tout le lot hors `features/rehearsal/` limité à `features.ts`, moins de 10 lignes) ; PDF comparé et validé par l'utilisateur, y compris visionneuse ouverte ; parcours complet en direct ; filtre de bruit                                                | 3 à 4     |
| **7. Validation et bascule** | Grille complète, latence A/B finale, test hors ligne, RF-6 contrôle 2 (fenêtre factice), relevé du poids (comparé au lot 1, documenté dans `web/README.md`), bascule `compose.yaml`, `compose.legacy-ui.yaml`, `ui.sh`, `install.sh`, tests de retour arrière (7.1), documentation, ADR accepté                                                                                                                                                                                                                                                                      | 1 à 6                        | Section 6 entièrement verte ; scénarios de retour arrière (7.1) exécutés et notés ; `validation/final-report.md` ; Go de l'utilisateur pour le merge                                                                                                                               | 2,5 à 3,5 |

L'ordre réduit le risque : l'oracle d'abord, la CSP réelle dès le lot 2, l'appel temps réel (cœur du produit, risque de latence et de fuites) avant l'habillage.

### 5.2 Estimation recalculée

Base de la spec : environ 400 lignes par jour pour la logique UI réécrite, environ 800 pour le code impératif encapsulé, une personne.

| Poste                | Plan initial | Ajustement                                                                                                                                                                 | Plan final        |
| -------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Spike                | 1,5 – 2      | Sans grille ni mesures (déplacées au lot 1) : -0,5 ; règle CSS sur la maquette : compris                                                                                   | **1 – 1,5**       |
| Lot 1 Oracle         | 2 – 3        | Grille et mesures faites une seule fois ici (pas de doublon) ; adaptateurs par interface +0,25 ; colonne portée et lignes amélioration +0,1 ; segment client et ABAB +0,15 | **2,5 – 3,5**     |
| Lot 2 Socle          | 2 – 3        | Gate de licences, script de poids retirés -0,4 ; `native-select`, contrôle des couches CSS, `version.json`, inventaire informatif +0,4                                     | **2 – 3**         |
| Lot 3 Appel          | 4 – 5        | `CallPlugin` complété ici pour RF-6 : compris                                                                                                                              | **4 – 5**         |
| Lot 4 Avatars        | 2 – 3        | —                                                                                                                                                                          | **2 – 3**         |
| Lot 5 Fenêtres       | 4 – 5        | `<select>` natifs et `confirm` conservés -0,25 ; transposition CSS explicite (M3) +0,75                                                                                    | **4,5 – 5,5**     |
| Lot 6 Répétition     | 3 – 4        | —                                                                                                                                                                          | **3 – 4**         |
| Lot 7 Validation     | 2 – 3        | Changements nginx sortis -0,25 ; `ui.sh` avec contrôle de `version.json` +0,25 ; scénarios de retour arrière défavorables +0,25 ; fenêtre factice +0,25                    | **2,5 – 3,5**     |
| **Total lots**       | 19 – 26      | +1,5                                                                                                                                                                       | **20,5 – 27,5**   |
| **Total avec spike** | 20,5 – 28    | +1                                                                                                                                                                         | **21,5 – 29 j-h** |

Marge : +20 % (soit jusqu'à environ 35 j-h) si la maquette impose une fidélité au pixel ou si le spike impose de remplacer Dialog par une variante native. Estimation revue à la sortie du spike (L9).

---

## 6. Stratégie de vérification

### 6.1 Grille de parité (`web/tests/PARITY.md`)

Colonnes : ID, fonctionnalité, **portée** (parité / amélioration), étapes, résultat attendu, résultat attendu hors ligne, vérification (auto-live, auto-mock ou manuelle), navigateur, statut ancienne interface, statut nouvelle interface, exception (accord écrit de l'utilisateur).

- **Parité** : doit être verte sur l'ancienne interface (lot 1) et sur la nouvelle.
- **Amélioration** : propre à la nouvelle interface, marquée « KO attendu » sur l'ancienne ; exemples : absence de flash du thème, au plus 1 contexte WebGL après 10 changements d'avatar, aucune violation CSP sur un Markdown contenant `style=`.

Familles :

- appel : démarrer, raccrocher, couper la parole, demi-duplex, micro refusé, serveur injoignable, session déjà ouverte, latence affichée ;
- six états visuels ;
- écrit : SSE, ajout au contexte, message pendant un appel, erreurs 413, 502 et 504 ;
- Markdown : code (dont un bloc `nginx` coloré, un `dockerfile`, un `powershell`), copier, liens externes « à vérifier », mots-clés, références, injection (`<img onerror>`, `<script>`, `style=`) ;
- pièces jointes ; réseau et partage ; agent et mode (suggérés, recherche, clavier, teinte) ; thème ;
- avatars et voix ; chaque fenêtre (dont les `<select>` et les `confirm`) ; Répétition (préparation, discours, questions, rapport, discussion, PDF, PDF avec visionneuse ouverte, historique) ;
- préférences héritées en `localStorage` ;
- recherche web et Claude : résultat attendu hors ligne explicite (indicateur réseau hors ligne, message d'indisponibilité) ;
- Firefox (manuel) : appel réel, une fenêtre, console sans violation CSP.

### 6.2 Tests Playwright et adaptateurs

- Les fixtures automatiques (garde hors ligne non intrusive, collecteur CSP) s'appliquent à tous les tests.
- Les tests n'appellent pas directement les sélecteurs : ils passent par une interface `UiAdapter` (`tests/adapters/index.ts`), choisie par la variable `ANTARES_UI=legacy|next` :
  - `openDialog(name)`, `closeDialog()`, `selectOption(label, value)`, `pickAgent(name)`, `pickMode(name)`, `toggleTheme(mode)`, `startCall()`, `hangUp()`, `sendText(text)`, `confirmNext(accept)` ;
  - l'implémentation `legacy` vise le `<dialog>` natif et le picker maison, l'implémentation `next` vise Radix (`role=dialog`) et `Command` ; les `<select>` natifs partagent la même implémentation ;
  - les sélecteurs par rôle et par nom accessible (`getByRole('button', { name: 'Appeler' })`) sont utilisés partout où ils fonctionnent sur les deux interfaces.
- Chaque test tourne sur l'ancienne interface (lot 1) puis sur la nouvelle (lots 3 à 7), `ANTARES_URL` pointant sur 8765 ou 8766.

### 6.3 Latence navigateur avant et après (correctif M1)

- `tests/support/latency.init.ts`, injecté par `addInitScript` (non soumis à la CSP de la page, identique pour les deux interfaces) :
  - enveloppe `window.WebSocket` pour horodater la réception de `input_audio_buffer.speech_stopped` (t0) et du premier `response.output_audio.delta` qui suit (t1) ;
  - enveloppe `AudioBufferSourceNode.prototype.start` pour horodater le premier appel qui suit t1 (t2) ;
  - empile `{ endToEnd: t2 - t0, client: t2 - t1 }` dans `window.__latency`.
- `tests/perf/latency.spec.ts` : **appels alternés ABAB** (ancienne sur 8765, nouvelle sur 8766, en séquence, une seule session à la fois), 20 mesures par interface après un appel à froid exclu pour chacune, même modèle, même voix, même fixture. Sortie dans `tests/results/latency-<date>.json` (ignoré par git).
- `node scripts/compare-latency.mjs baseline/legacy.json tests/results/latency-<date>.json` :
  - **bout en bout** : échec si la médiane de la nouvelle dépasse celle de l'ancienne de plus de 50 ms (DI-9) ; p90 relevé à titre d'information ;
  - **segment client** : échec si la médiane dépasse celle de l'ancienne de plus de 5 ms (seuil proposé, à confirmer) ; c'est le critère qui détecte une vraie régression du frontend.
- La référence du lot 1 sert de repère ; la mesure finale du lot 7 (ABAB) fait foi.

### 6.4 Images par seconde et Markdown

- `fps-probe.ts` : passages d'image avec dessin sur le canvas de l'avatar (enveloppes `drawElements` et `drawArrays` en WebGL, `clearRect` en 2D), sur 10 s d'appel ; comparaison relative à la référence, même rendu logiciel. Mesures faites dans `chromium-live`, sans interception réseau.
- `markdown.spec.ts` : `/api/chat` simulé avec `sse-5000.txt` ; durée entre la requête et le rendu final (MutationObserver) ; pas plus lent que la référence.

### 6.5 Test hors ligne

1. La garde non intrusive de 3.5 s'applique à toute la suite.
2. Le projet `offline-strict` rejoue les familles principales en bloquant toute requête hors de `baseURL`.
3. Toute la suite tourne pile lancée **avec Internet coupé sur l'hôte** ; les lignes « recherche web » et « Claude » sont jugées sur leur résultat attendu hors ligne.
4. `check-dist.mjs` : aucune URL `https?://` hors de `url-allowlist.txt` (chaque exception commentée).
5. `check-local.sh` et `smoke-test.sh` passent.

### 6.6 Ressources orphelines

`leak-probe.ts` enveloppe `AudioContext` (créations et `close`), `WebSocket` (ouvertures et fermetures) et `HTMLCanvasElement.prototype.getContext('webgl*')`. Après 10 appels : 0 `AudioContext` et 0 WS ouvert (parité). Après 10 changements d'avatar : au plus 1 contexte WebGL vivant (amélioration). Métriques CDP `Performance.getMetrics` (`JSEventListeners`, `Nodes`) avant et après : pas de croissance monotone.

### 6.7 Autres contrôles

- Préférences héritées : `addInitScript` pose `antares-theme=light`, `antares-avatar=bender`, `antares.noiseFilter=strong`, puis vérification de leur reprise.
- Absence de flash (amélioration) : `getComputedStyle(body).backgroundColor` clair au premier passage d'image.
- RF-4 : clavier et focus sur chaque fenêtre.
- Sécurité : injection Markdown nettoyée comme aujourd'hui, et sans violation CSP sur la nouvelle interface.
- Poids : relevé unique au lot 7 (`du` brut et gzip de `dist/`, comparé au relevé du lot 1), documenté dans `web/README.md` ; pas de script ni de seuil (DI-6).

---

## 7. Bascule, retour arrière, suppression de `frontend/`, documentation

### 7.1 Bascule (lot 7, sur Go)

1. Sur la branche de migration : `compose.yaml` (service `web` en image et build), ajout de `compose.legacy-ui.yaml` et `ui.sh`, suppression de `compose.web-next.yaml`, modification de `install.sh`, `preview:nginx` reciblé.
2. `./ui.sh new --build`, puis la suite complète sur 8765.
3. **Tests du retour arrière avant merge**, chacun noté (durée, résultat) dans `validation/final-report.md` :
   - (a) cas favorable : `./ui.sh legacy` (vérification `curl` et projet Playwright `smoke` sur l'ancienne interface), puis `./ui.sh new` ;
   - (b) `./ui.sh legacy`, puis `./install.sh` relancé : `COMPOSE_FILE` est conservé et l'ancienne interface est toujours servie ;
   - (c) `./ui.sh legacy`, puis un simple `docker compose up -d` : l'ancienne interface persiste ;
   - (d) `./ui.sh legacy` avec l'image `antares/web` supprimée (`docker image rm antares/web:latest`) et Internet coupé : l'ancienne interface démarre sur `nginx:1.29-alpine` sans construction ;
   - (e) image périmée : modification commitée dans `web/` sur une branche jetable de test, `docker compose up -d` (sert l'ancien build), puis `./ui.sh new` détecte l'écart de `version.json` et reconstruit.
4. Merge dans `develop` (`git flow feature finish`), sur Go explicite, après relecture (`/review`). Une release éventuelle suit le GitFlow habituel, sur décision de l'utilisateur.

### 7.2 Retour arrière

- **Niveau 1** (privilégié tant que `frontend/` existe) : `cd deploy/s2s && ./ui.sh legacy`. Le choix persiste dans `.env`. Pour revenir : `./ui.sh new`.
- **Niveau 2** : `git revert -m 1 <merge>` sur `develop` (via une branche `bugfix/*` ou `hotfix/*` selon la cible, conformément au GitFlow), puis `./ui.sh legacy` ou `docker compose up -d web`. Pour reprendre la migration ensuite, il faut d'abord **revert du revert** (`git revert <commit du revert>`) sur la branche de reprise, sinon un nouveau merge de la branche d'origine n'apporte rien. Documenté dans `deploy/s2s/README.md`.

### 7.3 Suppression de `frontend/` (après deux semaines d'observation sans régression)

Branche `feature/suppression-ancienne-interface` depuis `develop`.

1. Préalable sur chaque hôte : `./ui.sh new`, puis contrôle que `.env` ne contient plus `COMPOSE_FILE` (sinon toutes les commandes compose échoueraient une fois la surcharge supprimée).
2. Suppressions : `frontend/`, `compose.legacy-ui.yaml`, le mode `legacy` de `ui.sh` (le mode `new` reste pour le contrôle de `version.json`), le bloc `frontend/**` de `eslint.config.js` racine (ou le fichier), le hook `mirrors-eslint`, `exclude: ^frontend/vendor/` et l'exclusion du hook TODO, la ligne `!frontend/vendor/` du `.gitignore`, le `docker pull nginx:1.29-alpine` d'`install.sh`, la conservation de `COMPOSE_FILE` dans `ensure_tokens` (ou garder, sans effet), les mentions dans les documents.
3. Désormais, un retour arrière passe par un revert (avec la règle du revert du revert) et une reconstruction (`./ui.sh new --build`). Il n'existe pas d'image ancienne étiquetée.

### 7.4 Documentation

- `docs/adr/0012-interface-vite-react-shadcn.md` : brouillon complété par la décision CSP (relevé du spike, correctif retenu, éventuelle empreinte ou assouplissement justifié), les écarts avec la spec (licences informatives, `<select>` natifs, `confirm`, pas de notification), les mesures de latence (deux segments), le poids, le build à l'installation, la règle CSS. Statut Accepté au merge. Les ADR 0003, 0004, 0005 et 0011 ne sont pas réécrits.
- `README.md` racine : structure (`web/`) et lien vers `web/README.md`.
- `deploy/s2s/README.md` : interface construite pendant `install.sh`, boucle de dev (`npm --prefix web run dev`), vérification de la CSP réelle (`npm --prefix web run preview:nginx`), `ui.sh` et reconstruction après `git pull`, retour arrière (niveaux 1 et 2, revert du revert), remplacement de « Bibliothèques servies localement : `frontend/vendor/` » par l'inventaire des licences, tests Playwright (dev uniquement), chemins de code cités (`face3d.js`, `createVoiceEffect`).
- `docs/solution-antares.md` : lignes « Interface » (166) et « Rendu » (262).
- `web/README.md` : prérequis (Node 24, `npm ci --ignore-scripts`), commandes, liste noire shadcn, règle CSS et couches, politique de mise à jour (lockfile, audit, digests), architecture (registre, moteurs, frontières), poids relevé.
- `CLAUDE.md` projet (ignoré par git, mis à jour en local) : ligne de stack, commandes essentielles (dev, `preview:nginx`, tests e2e, `ui.sh`), ADR 0012.

---

## 8. Risques résiduels et points à confirmer

### 8.1 Risques résiduels

| Risque                                                                                    | Mitigation restante                                                                     |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Un composant Radix ajouté plus tard réintroduit un `<style>`                              | Collecteur CSP dans tous les tests ; liste noire documentée                             |
| Le shim ou la feuille constructible diverge d'une version future de `react-remove-scroll` | Versions verrouillées ; mise à jour volontaire avec relevé CSP rejoué                   |
| `%noloop` ne repart pas au début à chaque `getUserMedia`, faussant les appels             | Vérifié au spike (L9) ; sinon nouveau contexte navigateur entre deux appels             |
| Bruit de mesure côté serveur sur le bout en bout                                          | Segment client mesuré à part ; ABAB ; premier appel exclu ; médiane et p90              |
| Images par seconde en rendu logiciel peu représentatives                                  | Comparaison relative ; contrôle manuel sur le poste (grille)                            |
| Firefox (navigateur recommandé) non automatisé                                            | Lignes manuelles obligatoires dans la grille et à la bascule                            |
| Trous du lockfile pour les binaires optionnels d'une autre plateforme                     | Image de build glibc ; `docker build` propre au lot 2                                   |
| Image servie périmée après `git pull`                                                     | `version.json` et `ui.sh new` ; documentation de la reconstruction                      |
| Dérive de la transposition CSS                                                            | Règle 2.9 validée sur la maquette ; inventaire des blocs par lot ; contrôle des couches |
| Gel de l'interface actuelle                                                               | Report des `bugfix/*` ; lots courts commités sur Go                                     |
| Données réelles modifiées par les tests                                                   | Fenêtres CRUD en mock ; tests en direct en lecture seule                                |

### 8.2 Points restant à confirmer

1. **Seuil du segment client** : +5 ms sur la médiane proposé (le seuil de bout en bout, +50 ms, est validé).
2. **Option CSP** et **fidélité visuelle** : tranchées sur les livrables du spike (L3, L4, L6), selon la table 1.5.
3. Les tests d'appel en direct mobilisent s2s (GPU) ; seul le navigateur reste en rendu logiciel. À valider comme lecture de RNF-1.

---

### Fichiers critiques pour l'implémentation

- `/datadisk/ai-projects/antares_ai/frontend/app.js` (logique d'appel à encapsuler dans `CallEngine`, contrat de plugin de la Répétition)
- `/datadisk/ai-projects/antares_ai/frontend/rehearsal.js` (plus gros module, plugin d'appel, impression)
- `/datadisk/ai-projects/antares_ai/frontend/render.js` (options DOMPurify, langues highlight.js)
- `/datadisk/ai-projects/antares_ai/frontend/style.css` (variables de thème, règles `@media print`, blocs à transposer)
- `/datadisk/ai-projects/antares_ai/deploy/s2s/compose.yaml` (service `web`, surcharges)
- `/datadisk/ai-projects/antares_ai/deploy/s2s/nginx.conf.template` (CSP)
- `/datadisk/ai-projects/antares_ai/deploy/s2s/install.sh` (`ensure_tokens`, build de l'interface, pull nginx)
- `/datadisk/ai-projects/antares_ai/.pre-commit-config.yaml` (hooks locaux pour `web/`)
- `/datadisk/ai-projects/antares_ai/frontend/theme.js`, `/datadisk/ai-projects/antares_ai/frontend/avatar.js`, `/datadisk/ai-projects/antares_ai/frontend/capture-worklet.js`
