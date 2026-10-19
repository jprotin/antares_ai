# Grille de parité — ancienne interface (`frontend/`) contre nouvelle (`web/`)

Référence : `.claude/features/migration-nextjs-shadcn/tasks/test-strategy.md` §5. L'ancienne
interface est l'oracle : une ligne « parité » doit être verte sur `legacy` avant d'être
exigée sur `next`. Une ligne « amélioration » est en KO attendu sur `legacy`.

Lancement : `ANTARES_UI=legacy|next npx playwright test --project=<projet>` (`web/`).

Statuts : **V** vert, **KO-att** KO attendu (amélioration), **—** non exécuté, **M** manuel
à faire, **fixme** lot non livré. Toute exception exige l'accord écrit de l'utilisateur
(colonne Exception, avec la date).

## Lignes

| ID   | Fonctionnalité                                                      | Portée       | Vérification             | Lot | Attendu                                                                                            | Hors ligne     | Navigateur | Ancienne            | Nouvelle        | Exception |
| ---- | ------------------------------------------------------------------- | ------------ | ------------------------ | --- | -------------------------------------------------------------------------------------------------- | -------------- | ---------- | ------------------- | --------------- | --------- |
| AP-1 | Appel : démarrer, parler, réponse audio, raccrocher                 | parité       | auto-live                | 3   | états `listening`, `user`, `thinking`, `speaking`, `idle` ; sous-titres ; « réponse en x s »       | identique      | Chromium   | V                   | V (live)        |           |
| AP-2 | Trames micro                                                        | parité       | auto-mock                | 3   | `input_audio_buffer.append` de 1 280 caractères (20 ms PCM16 24 kHz) ; worklet hors bundle         | identique      | Chromium   | V                   | V               |           |
| AP-3 | Couper la parole                                                    | parité       | auto-mock                | 3   | `speech_started` pendant la lecture : lecture arrêtée, « interrompu »                              | identique      | Chromium   | V                   | V               |           |
| AP-4 | Demi-duplex                                                         | parité       | auto-mock                | 3   | micro tenu pendant la lecture, rouvert au retour à l'écoute (traîne d'écho : Répétition seulement) | identique      | Chromium   | V                   | V               |           |
| AP-5 | Six états visuels                                                   | parité       | auto-mock                | 3   | `data-state` et libellé pour chaque événement                                                      | identique      | Chromium   | V                   | V               |           |
| AP-6 | Micro refusé ou absent                                              | parité       | auto-mock                | 3   | « Accès au micro refusé » / « Impossible de démarrer l'appel », état `idle`, bouton actif          | identique      | Chromium   | V                   | V               |           |
| AP-7 | WS coupé en cours d'appel                                           | parité       | auto-mock                | 3   | « Appel terminé », `idle`, bouton « Appeler »                                                      | identique      | Chromium   | V                   | V               |           |
| AP-8 | Session déjà ouverte                                                | parité       | auto-mock                | 3   | « Une conversation est déjà en cours dans un autre onglet »                                        | identique      | Chromium   | V                   | V               |           |
| AP-9 | Dix appels successifs                                               | parité       | auto-live                | 3   | 0 `AudioContext`, 0 WS ouverts ; une ouverture WS par appel                                        | identique      | Chromium   | V                   | V (live)        |           |
| EC-1 | Réponse écrite SSE                                                  | parité       | auto-mock + live         | 3   | rendu en flux, « écrit · x s », corps de requête                                                   | identique      | Chromium   | V (mock + live)     | V (mock + live) |           |
| EC-2 | Erreurs 413, 502, 504, réseau                                       | parité       | auto-mock                | 3   | « réponse impossible : … », état `idle`                                                            | identique      | Chromium   | V                   | V               |           |
| EC-3 | SSE interrompu                                                      | parité       | auto-mock                | 3   | texte partiel conservé, ligne en erreur, saisie réactivée                                          | identique      | Chromium   | V                   | V               |           |
| EC-4 | Écrit pendant un appel, ajout au contexte                           | parité       | auto-mock                | 3   | relance après `response.done`                                                                      | identique      | Chromium   | V                   | V               |           |
| MD-1 | Code coloré, Copier, lien « à vérifier »                            | parité       | auto-mock                | 3   | classes `hljs-`, bouton Copier, `target`, `rel`, titre                                             | identique      | Chromium   | V                   | V               |           |
| MD-2 | Injection HTML                                                      | parité       | auto-mock                | 3   | `<img onerror>` et `<script>` retirés, rien n'est exécuté                                          | identique      | Chromium   | V (1)               | V (0 violation) |           |
| MD-3 | Markdown avec `style=`                                              | amélioration | auto-mock                | 3   | aucune violation CSP                                                                               | identique      | Chromium   | KO-att              | V               |           |
| MD-4 | Rendu de 5 000 caractères                                           | parité       | perf                     | 3   | durée ≤ référence                                                                                  | identique      | Chromium   | V (2)               | écart (8)       |           |
| PJ-1 | Pièces jointes : ajout, retrait, tout retirer                       | parité       | auto-mock                | 3   | `POST` et `DELETE` `api/documents` ; « Nouvelle conversation » vide la liste ; trop gros refusé    | identique      | Chromium   | V                   | V               |           |
| RS-1 | Indicateur réseau et transitions                                    | parité       | auto-mock (`page.clock`) | 3   | libellés, titre, ligne système à la transition                                                     | « Hors ligne » | Chromium   | V                   | V               |           |
| RS-2 | Partage ngrok actif                                                 | parité       | auto-mock + manuel       | 3   | « Internet · partagé », Claude et écriture RAG coupés                                              | identique      | Chromium   | V + M (3)           | V (interface)   |           |
| RS-3 | Recherche web et Claude hors ligne                                  | parité       | offline                  | 7   | indicateur « Hors ligne », message explicite                                                       | attendu propre | Chromium   | —                   | fixme           |           |
| AG-1 | Sélecteur d'agent et de mode, teinte                                | parité       | auto-mock                | 3   | `--hue` = 246 pour un agent Sécurité                                                               | identique      | Chromium   | V                   | V               |           |
| TH-1 | Thème : bascule, persistance, OS                                    | parité       | auto-mock                | 2   | auto → sombre → clair, rechargement, suivi de l'OS                                                 | identique      | Chromium   | V                   | V               |           |
| TH-2 | Pas de flash du thème clair                                         | amélioration | auto-mock                | 2   | thème posé avant le premier rendu                                                                  | identique      | Chromium   | KO-att              | V               |           |
| PR-1 | Préférences héritées (`localStorage`)                               | parité       | auto-mock                | 2   | `antares-theme`, `antares-avatar`, `antares.noiseFilter` repris                                    | identique      | Chromium   | V                   | V               |           |
| AV-1 | Avatars et voix alignées                                            | parité       | auto-mock                | 4   | voix liée à l'avatar, Mr/Miss seulement sur l'orbe                                                 | identique      | Chromium   | V                   | fixme           |           |
| AV-2 | WebGL absent                                                        | parité       | auto-mock                | 4   | repli sur l'orbe, aucune erreur JS                                                                 | identique      | Chromium   | V                   | fixme           |           |
| AV-3 | Dix changements d'avatar                                            | amélioration | auto-live                | 4   | au plus 1 contexte WebGL vivant                                                                    | identique      | Chromium   | KO-att              | fixme           |           |
| AV-4 | Images par seconde orbe et avatars                                  | parité       | perf + manuel GPU        | 4   | baisse < 10 %                                                                                      | identique      | Chromium   | M (4)               | fixme           |           |
| FE-1 | Réglages                                                            | parité       | auto-mock + live lecture | 5   | avatar, voix, modèle, projet, Appliquer/Annuler                                                    | identique      | Chromium   | V                   | fixme           |           |
| FE-2 | Connexions (fournisseurs, test, repli, RAG, recherche, Claude, MCP) | parité       | auto-mock + live lecture | 5   | parcours nominal, erreur affichée, `confirm`                                                       | identique      | Chromium   | V (mock + live)     | fixme           |           |
| FE-3 | Agents                                                              | parité       | auto-mock + live lecture | 5   | filtre, formulaire, suppression avec `confirm`                                                     | identique      | Chromium   | V                   | fixme           |           |
| FE-4 | Fiches de connaissance                                              | parité       | auto-mock + live lecture | 5   | proposer, éditer, similaires, suppression                                                          | identique      | Chromium   | V (mock + live)     | fixme           |           |
| FE-5 | Projets du RAG intégré                                              | parité       | auto-mock + live lecture | 5   | créer, ajouter des fichiers, supprimer                                                             | identique      | Chromium   | V (mock + live)     | fixme           |           |
| FE-6 | Fenêtres : Échap, clic extérieur, focus                             | parité       | auto-mock                | 5   | fermeture, focus piégé et rendu                                                                    | identique      | Chromium   | V                   | V (coquille)    |           |
| FE-7 | Formulaires refermés masqués (fournisseur, fiche)                   | amélioration | auto-mock                | 5   | formulaire masqué une fois refermé (`hidden` respecté)                                             | identique      | Chromium   | KO-att (6)          | fixme           |           |
| FE-8 | Champ identifiant de fournisseur validé                             | amélioration | auto-mock                | 5   | motif valide pour Chromium, aucune erreur console                                                  | identique      | Chromium   | KO-att (6)          | fixme           |           |
| RE-1 | Répétition complète                                                 | parité       | auto-mock + manuel       | 6   | phases, horloge, slides, rapport, discussion, historique                                           | identique      | Chromium   | V                   | fixme           |           |
| RE-2 | Raccourcis de slides inactifs fenêtre ouverte                       | parité       | auto-mock                | 6   | flèches sans effet si fenêtre ouverte ou focus dans un champ                                       | identique      | Chromium   | V                   | fixme           |           |
| RE-3 | Filtre de bruit                                                     | parité       | unitaire + auto-mock     | 6   | calibrage, seuil, réglage mémorisé, `vad` envoyé                                                   | identique      | Chromium   | V (unitaire + mock) | fixme           |           |
| RE-4 | PDF du rapport                                                      | parité       | auto + manuel            | 6   | pages, textes absents (barre, discussion, contrôles)                                               | identique      | Chromium   | V (5)               | fixme           |           |
| FF-1 | Firefox : appel réel                                                | parité       | manuel                   | 7   | appel complet au vrai micro                                                                        | identique      | Firefox    | M                   | M               |           |
| FF-2 | Firefox : une fenêtre                                               | parité       | manuel                   | 5   | ouverture, Échap, focus                                                                            | identique      | Firefox    | M                   | M               |           |
| FF-3 | Firefox : console sans violation CSP                                | parité       | manuel + spike           | 7   | aucune violation                                                                                   | identique      | Firefox    | M                   | V (spike)       |           |

(1) Sur l'ancienne interface, l'analyse de DOMPurify signale `script-src-attr` (bloqué, sans
effet). La nouvelle retire les gestionnaires `on*` et les attributs `style` avant l'analyse.

(2) Référence : 8,25 ms en médiane (p90 9,4 ms) pour 5 000 caractères ; la nouvelle doit
rester sous la référence × 1,2 (`tests/perf/rendu.spec.ts`, `UPDATE_BASELINE=1` pour la réécrire).

(3) Libellé « Internet · partagé », titre et lignes système vérifiés en mock. La coupure de
Claude et de l'écriture RAG est appliquée par le routeur, pas par l'interface : vérification
manuelle (ou sur la vraie pile) pendant un partage.

(4) Sous swiftshader, l'orbe et les avatars plafonnent à 60 images par seconde, même processeur
ralenti six fois : le critère ne discrimine pas. Indicateur ajouté, non bloquant : temps de
calcul par image (orbe 0,32 ms, avatars 3D 0,14 à 0,15 ms). Mesure sous vrai GPU : manuelle.

(5) `page.pdf()` A4 : 2 pages ; textes présents et absents dans `tests/baseline/report-pdf.json`,
PDF dans `tests/baseline/report-legacy.pdf` (rapport simulé `repetition-test-3`). Porte G4
validée le 2026-10-19 (relecture des deux pages par Claude, enchaînement accordé par
l'utilisateur). Le lien « Voir l'historique » est imprimé : gardé par parité.

(6) Défauts relevés sur l'ancienne interface : `.agent-form { display: grid }` l'emporte sur
`hidden` (`#provider-form`, `#knowledge-form` restent visibles) ; `pattern` de `#provider-id`
invalide en mode `v` (Chromium l'écrit en `console.error` et ne valide pas le champ, toléré
dans FE-2 par `allowConsoleErrors`).

(7) Les specs FE-2, FE-4, FE-5, RE-1 à RE-4 et AV-1, AV-2 visent encore le DOM de l'ancienne
interface (identifiants `#…`, classes) : leurs zones passeront par l'adaptateur (méthodes ou
`data-testid` communs) au début des lots 4, 5 et 6, avant d'être exigées sur `next`.

(8) MD-4 sur la nouvelle interface (2026-10-19, orbe des deux côtés, N = 20) : 10,2 à 10,5 ms
en médiane contre 7,8 à 8,1 ms pour l'ancienne, soit +2,3 ms (+29 %), au-delà du seuil de
+10 %. Profil CPU : le rendu Markdown est identique (6,7 ms, mêmes bibliothèques) ; l'écart est
le rendu React (création des composants, insertion du HTML). Deux corrections déjà faites
(rendu final sans attendre une image, défilement hors du rendu). Exception à accorder ou non
par l'utilisateur.

## Latence (référence, `tests/baseline/legacy.json`)

Série A/A sur l'ancienne interface, ABAB, N = 20 + 20, modèle actif Claude Sonnet (bridge) :

| Segment                                                   | Médiane  | p90      | Écart A/A des médianes |
| --------------------------------------------------------- | -------- | -------- | ---------------------- |
| Bout en bout (`speech_stopped` → premier `start()`)       | 3 015 ms | 3 449 ms | 211 ms                 |
| Client (premier `output_audio.delta` → premier `start()`) | 0,6 ms   | 0,7 ms   | 0 ms                   |

Série ancienne (A) contre nouvelle (B), lot 3, même protocole : bout en bout 3 192 ms contre
3 210 ms (+18,7 ms), segment client 0,6 ms contre 0,6 ms (-0,0 ms, seuil +5 : tenu).

Conclusion : avec Claude, le bruit de mesure de bout en bout (211 ms) dépasse le seuil de
+50 ms, qui ne discrimine donc rien. Critère bloquant retenu : **segment client ≤ +5 ms**.
Le bout en bout reste rapporté ; pour le rendre bloquant, il faut une série avec un modèle
local stable (gemma4:e4b), ce qui demande de changer le modèle actif le temps de la mesure.
Décision de l'utilisateur (2026-10-19) : seuil navigateur seul, pas de série gemma.

## Unitaire (Vitest, `tests/unit/`)

| Module                                                                                                    | Ancienne | Nouvelle      |
| --------------------------------------------------------------------------------------------------------- | -------- | ------------- |
| `noise-gate` (13 cas)                                                                                     | V        | fixme (lot 6) |
| `hueFor`, `instructionsFor`, `writtenInstructionsFor` (15 cas, vecteurs dorés)                            | V        | V (lot 2)     |
| Vecteurs dorés : `base64FromPcm`, `floatFromBase64Pcm`, `recentHistory`, lecture SSE (`legacy-internals`) | V        | V (lot 2)     |
| Vecteurs dorés : `clock`, `longClock`, `initialScores`, `newPart`                                         | V        | fixme (lot 6) |
| `lib/` (`api`, `markdown`, `storage`), `theme-init`, store, couches CSS, `check-dist`, règles eslint      | —        | V (lot 2)     |

## Transposition de `style.css` (2 413 lignes, compté après le merge de la Répétition)

| Lignes    | Bloc                                                                     | Lot   | Statut                                                                                            |
| --------- | ------------------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------- |
| 1-126     | Jetons de thème, `@property --hue`, `body`, `.app`                       | 2     | fait (`src/index.css`, vérifié au lot 2 par TH-1 et TH-2) ; `.app` au lot 3                       |
| 127-246   | Colonne gauche : l'appel (scène, orbe, bouton, statut)                   | 3     | fait (`features/call/call.css`)                                                                   |
| 247-329   | Colonne droite : la conversation                                         | 3     | fait (`features/conversation/conversation.css`)                                                   |
| 330-629   | Réponses écrites mises en forme (code, liens, mots-clés, pièces jointes) | 3     | fait (`features/conversation/conversation.css`) ; puces des listes rétablies (preflight)          |
| 630-719   | Boutons et icônes (fantôme, icône)                                       | 2     | fait (`styles/legacy-shared.css`, `conversation.css`)                                             |
| 720-737   | Écrans étroits : empilement                                              | 3     | fait (`app/shell.css`)                                                                            |
| 738-949   | Réglages                                                                 | 5     | à faire                                                                                           |
| 950-1101  | Agents                                                                   | 5     | à faire                                                                                           |
| 1102-1298 | Barre du haut : agent, mode, thème, réglages (sélecteurs)                | 3     | fait (`app/shell.css`, `features/pickers/pickers.css` : panneau positionné par Radix, états cmdk) |
| 1299-1377 | Fenêtres : en-tête et actions fixes, plein écran sur mobile              | 5     | à faire (`Dialog`)                                                                                |
| 1378-1556 | Recherche web, indicateur réseau, fiches                                 | 3 / 5 | recherche web et réseau faits (`net.css`, `conversation.css`) ; fiches au lot 5                   |
| 1557-1568 | Choix de la voix sous l'orbe                                             | 4     | à faire                                                                                           |
| 1569-1657 | Connexions                                                               | 5     | à faire                                                                                           |
| 1658-2101 | Répétition : panneau, slides, questions, rapport                         | 6     | à faire                                                                                           |
| 2102-2163 | Impression du rapport                                                    | 6     | à faire (`print.css`)                                                                             |
| 2164-2219 | Micro de la répétition                                                   | 6     | à faire                                                                                           |
| 2220-2413 | Note révisée, discussion, historique                                     | 6     | à faire                                                                                           |

Défaut corrigé au passage : `--overlay` cyclique en thème sombre (lignes 45-46).

Lot 3 : jetons de `style.css` (lignes 1-88) repris en entier dans `src/index.css` ; interligne
du navigateur rétabli sur `body` (Tailwind impose 1.5). Comparaison visuelle (sombre et clair,
sélecteur ouvert) : `.claude/features/migration-nextjs-shadcn/validation/lot3/`. Écarts
attendus : avatar 3D (lot 4), « Proposer au RAG » (lot 5), bouton Répétition (lot 6).

## Poids servi (référence)

| Interface                                            | Brut     | gzip -9 |
| ---------------------------------------------------- | -------- | ------- |
| `frontend/` (HTML, CSS, JS, `vendor/`, `avatars3d/`) | 1 221 Ko | 335 Ko  |
| `web/` socle (fin du spike, sans écrans)             | 236 Ko   | 66 Ko   |
| `web/` fin du lot 2 (coquille, thème, Réglages vide) | 323 Ko   | 95 Ko   |

Relevé le 2026-10-19. three.js est chargé au démarrage par l'ancienne interface ; `web/` ne l'importe qu'au lot 4 (parité attendue alors).
