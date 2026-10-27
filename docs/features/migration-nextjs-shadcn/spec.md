# Spec finale — Migration du frontend vers Vite + React + shadcn/ui

**Slug** : `migration-nextjs-shadcn` (conservé pour l'historique ; Next.js n'est plus retenu)
**Sources** : [analysis.md](analysis.md), [analysis-challenge.md](analysis-challenge.md)
(3 bloquants, 6 majeurs, 6 mineurs), décisions de l'utilisateur du 2026-10-19
**ADR** : [adr-draft.md](adr-draft.md) (ADR-0012)

## Résumé

Réécrire l'interface web d'antares (`frontend/`, HTML/CSS/JS vanilla sans build) en
React + TypeScript, construite par Vite, avec les composants shadcn/ui (Tailwind + Radix).
Le but est de structurer le code en composants isolés pour que les fonctionnalités à venir
(archive, historique, portabilité) coûtent moins cher. Pour l'utilisateur, rien ne change :
mêmes fonctionnalités, même latence, toujours 100 % local et hors ligne. Un spike de
1 à 2 jours sert de porte go/no-go, puis la bascule se fait en une fois (big-bang), avec
un retour arrière écrit et testé.

## Décisions actées

| #   | Sujet       | Décision                                                                                                                                                                        | Origine                            |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| D1  | Socle       | Vite + React + shadcn/ui ; Next.js abandonné (l'export statique en perd les atouts et génère des scripts en ligne, incompatibles avec `script-src 'self'`)                      | Utilisateur, challenge B1          |
| D2  | CSP         | Tranchée **après le spike**, d'après des critères écrits à l'avance (section Spike) ; `script-src 'self'` reste non négociable                                                  | Utilisateur, challenge B2          |
| D3  | Stratégie   | Spike, puis big-bang sur une branche dédiée créée depuis `develop`, **après la soutenance et le merge de `feature/repetition`** ; bascule unique, retour arrière défini (RNF-6) | Utilisateur, challenge M2, M4      |
| D4  | Langage     | TypeScript recommandé ; **hypothèse à confirmer au plan**                                                                                                                       | Utilisateur (non contredit)        |
| D5  | Service     | Fichiers statiques servis par nginx ; pas de serveur Node en production                                                                                                         | Spec initiale (point solide)       |
| D6  | Emplacement | Nouveau code dans un répertoire distinct (`web/` proposé) ; `frontend/` conservé jusqu'à la fin de la période d'observation                                                     | Challenge M2 (à confirmer au plan) |

## Problème à résoudre et critère de succès

**Constat mesuré** : la fonctionnalité Répétition (non committée) ajoute deux modules
(`rehearsal.js` 1 332 lignes, `noise-gate.js` 111), mais modifie aussi trois fichiers
partagés par toute l'interface : `style.css` (+757), `index.html` (+228) et `app.js` (+97),
soit environ 1 080 lignes dans des fichiers globaux. Connexions des services (73e96a6) a
touché `index.html`, `style.css` et `connections.js` en plus de son module. Depuis le
29/09, `frontend/` a reçu 28 commits. Chaque fonctionnalité gonfle des fichiers globaux
(feuille de style de 2 413 lignes, page de 820 lignes, 7 `<dialog>`), ce qui multiplie les
conflits et les régressions de style.

**Critère de succès (RF-6 ci-dessous)** : après la migration, une fenêtre type (par exemple
Répétition) tient dans son propre répertoire de composants, avec ses styles. L'enregistrer
ne touche au plus qu'un fichier partagé, sur moins de 10 lignes, sans modifier aucune
feuille de style globale ni aucun fichier HTML.

Pour mémoire, le `<dialog>` natif fournit déjà Échap, le piège à focus et l'inertie du
reste de la page : shadcn/ui n'apporte donc pas ces comportements, il les **conserve**.
L'apport recherché est l'isolement des composants et un design system commun.

## Contexte (corrigé)

- `frontend/` compte environ 10 200 lignes : `style.css` 2 413, `rehearsal.js` 1 332,
  `app.js` 1 053, `avatars3d/` 1 010, `index.html` 820, `face3d.js` 579, plus une
  quinzaine de modules.
- **three.js est importé de façon statique** : `avatar.js` importe `face3d.js`,
  `bender.js` et `visor.js`, qui importent three. Il est donc chargé dès le démarrage. Le
  charger à la demande serait une amélioration hors parité (priorité Could).
- Le rendu Markdown en flux est cadencé par `requestAnimationFrame` (`render.js`).
- CSP exacte (`deploy/s2s/nginx.conf.template`) :
  `default-src 'self'; connect-src 'self'; media-src 'self' blob:; style-src 'self'; script-src 'self'`.
- `smoke-test.sh` se connecte directement à `ws://s2s:8765/v1/realtime`, sans passer par
  nginx ni par le navigateur. `check-local.sh` contrôle les réseaux Docker, mais ne voit
  aucune requête du navigateur. **Aucun des deux ne vérifie l'interface.**

## Spike — porte go/no-go (1 à 2 jours)

Le spike se fait sur une branche jetable créée depuis `develop`. Ses livrables :

1. **Page témoin** en Vite + React + TS + shadcn/ui, avec Dialog, Select, notification
   (toast) et bascule de thème clair/sombre, construite puis servie par **le vrai nginx et
   la CSP actuelle**.
2. **Relevé des violations CSP** (console navigateur et rapport Playwright) : pour chacune,
   la directive, la source (bibliothèque, composant) et sa nature (balise `<style>`
   injectée, attribut `style` dans le HTML, script).
3. **Liste précise de ce qu'il faudrait céder**, limitée à `style-src`, pour atteindre
   zéro violation, avec les alternatives possibles (autre composant de notification,
   variante sans injection de style, etc.).
4. **Boucle de développement** (cf. RF-7) qui fonctionne sur la page témoin.
5. **Maquette visuelle** de l'écran d'appel et d'une fenêtre, soumise à l'utilisateur pour
   trancher la fidélité visuelle (challenge M6).
6. **Grille de parité** complète (cf. RF-1) et **mesures de référence** sur l'interface
   actuelle : latence et images par seconde (cf. RF-2, RNF-1).
7. **Estimation révisée** à partir des mesures du spike.

**Critères de décision**, fixés avant le spike :

| Résultat du spike                                                                                                                        | Décision                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Zéro violation avec la CSP actuelle                                                                                                      | Go, CSP inchangée                                                                                           |
| Violations sur `style-src` seulement, supprimables en remplaçant ou configurant les composants fautifs pour un effort de 2 jours au plus | Go, CSP inchangée, composants adaptés                                                                       |
| Violations sur `style-src` seulement, impossibles à supprimer raisonnablement                                                            | Arbitrage de l'utilisateur : accepter un assouplissement de `style-src` seul (justifié dans l'ADR) ou no-go |
| Au moins une violation `script-src` sans correctif dans le code                                                                          | No-go : on reste sur l'interface actuelle et on revoit l'approche                                           |
| Boucle de dev ou proxy WebSocket/SSE non fonctionnel                                                                                     | No-go jusqu'à résolution                                                                                    |

## Exigences fonctionnelles

### RF-1 — Parité fonctionnelle complète (Must)

Toutes les fonctionnalités actuelles sont conservées : appel vocal (micro, half-duplex,
haut-parleur, filtre de bruit), conversation écrite en flux (SSE), sous-titres, six états
visuels, orbe et avatars 3D avec leur voix, sélecteurs d'agent et de mode, réglages,
connexions, RAG (fiches, projets du RAG intégré), agents, pièces jointes, recherche web et
indicateur réseau, répétition (rapport, discussion, PDF), thème.

- Given la **grille de parité produite pendant le spike** (une ligne par fonctionnalité :
  étapes, résultat attendu, mode de vérification automatique ou manuel) When elle est
  rejouée sur la nouvelle interface Then **toutes** les lignes passent. Une exception n'est
  admise qu'avec l'accord écrit de l'utilisateur, consigné dans la grille.
- Given les préférences existantes en `localStorage` (thème, avatar, filtre de bruit) When
  la nouvelle interface s'ouvre Then elles sont reprises telles quelles.
- Given les parcours de la grille marqués « automatique » When la suite Playwright tourne
  Then elle réussit.

### RF-2 — Appel temps réel sans régression (Must)

- Given Chromium lancé par Playwright avec un micro simulé (fichier audio), sur la vraie
  pile servie par nginx When N appels (20 proposé) sont passés sur l'ancienne puis sur la
  nouvelle interface Then l'écart de **latence mesurée dans le navigateur** (réception de
  `input_audio_buffer.speech_stopped`, puis premier `AudioBufferSourceNode.start`) reste
  sous le seuil fixé (+50 ms sur la médiane proposé, à confirmer).
- Given un appel When le micro est capté Then les trames envoyées restent en PCM16 24 kHz
  par blocs de 20 ms (`capture-worklet.js` servi hors bundle).
- Given dix appels successifs sans recharger la page When on inspecte les ressources Then
  il ne reste ni `AudioContext`, ni WebSocket, ni contexte WebGL orphelin.

### RF-3 — Thème clair / sombre et nuance par agent (Must)

- Given le thème « système » When l'OS bascule Then l'interface suit sans recharger.
- Given un agent du domaine « Sécurité » When il est sélectionné Then la teinte est 246,
  comme aujourd'hui (`hueFor`).
- Given un thème clair enregistré When la page se charge Then **aucun flash** du thème
  sombre, sans script en ligne (CSP respectée).

### RF-4 — Fenêtres et contrôles en shadcn/ui (Should)

Les fenêtres, sélecteurs, champs et notifications reposent sur shadcn/ui, habillés selon la
maquette validée pendant le spike.

- Given une fenêtre ouverte When l'utilisateur appuie sur Échap ou clique hors de la
  fenêtre Then elle se ferme, et le focus reste piégé tant qu'elle est ouverte (parité
  avec `<dialog>`).

### RF-5 — Impression PDF du rapport de répétition (Must)

- Given un rapport affiché When l'utilisateur imprime en PDF (Chromium) Then le PDF ne
  contient que le rapport et ressemble au PDF de référence produit avant migration
  (comparaison visuelle page par page, validée par l'utilisateur).

### RF-6 — Structure en composants (Must, critère du bénéfice)

- Given le code migré When on examine la fenêtre Répétition Then elle tient dans son propre
  répertoire avec ses styles, et la brancher ne modifie qu'un seul fichier partagé, sur
  moins de 10 lignes.

### RF-7 — Boucle de développement (Must)

- Given la pile s2s lancée (`docker compose up -d`) When le mainteneur lance une seule
  commande documentée Then le serveur de dev Vite sert l'interface avec rechargement à
  chaud. Il proxifie `/v1/` (WebSocket), `/api/` (SSE sans mise en tampon), `/voices/` et
  `/config.json` vers nginx (`127.0.0.1:8765`), et un appel complet y fonctionne.
- Given une modification When on veut vérifier la vraie CSP Then une seconde commande
  documentée construit et sert le résultat via nginx. Le serveur de dev ne peut pas
  appliquer la CSP de production, car le rechargement à chaud de React a besoin d'un script
  en ligne.

## Exigences non-fonctionnelles

### RNF-1 — Performance

- Latence : cf. RF-2.
- Fluidité : pendant un appel, les images par seconde de l'orbe et de chaque avatar 3D ne
  baissent pas de plus de 10 % par rapport à la référence ; le rendu d'une longue réponse
  Markdown (référence : un texte de 5 000 caractères) ne dure pas plus longtemps
  qu'aujourd'hui. Le rendu en flux reste cadencé à l'image.
- Le build, le serveur de dev et les tests ne consomment pas de GPU (tests WebGL en rendu
  logiciel). La VRAM reste réservée à s2s et Ollama.
- Poids du bundle mesuré et documenté (référence : l'actuel, three.js compris).

### RNF-2 — Sécurité

- `script-src 'self'` inchangé. Pour `style-src`, on applique la décision prise à la sortie
  du spike, et tout assouplissement est justifié dans l'ADR-0012. Les autres directives
  (`connect-src`, `media-src 'self' blob:`, `default-src`) ne bougent pas.
- Markdown toujours nettoyé par DOMPurify avant insertion ; aucune insertion de HTML brut
  sans nettoyage.
- Comportement inchangé en partage ngrok (Claude et écriture RAG coupés).

### RNF-3 — 100 % local et hors ligne

- Given la pile lancée hors ligne When la suite Playwright tourne Then elle **échoue dès
  qu'une requête sort de l'origine `127.0.0.1:8765`** (polices, CDN, télémétrie).
- Given le résultat du build When on y cherche des URL `https?://` Then seules figurent
  des exceptions listées et justifiées (licences, commentaires).
- `check-local.sh` et `smoke-test.sh` passent toujours. Ils restent nécessaires, mais ne
  suffisent pas à vérifier l'interface.

### RNF-4 — Chaîne npm et installation

- `package-lock.json` versionné ; installation par `npm ci --ignore-scripts`. Un paquet qui
  exige un script d'installation doit être justifié.
- Build dans une étape Docker multi-stage sur une **image Node épinglée par digest** ;
  image finale nginx sans Node.
- `npm audit` exécuté par une commande documentée (et en pre-commit si le temps le
  permet) : aucune vulnérabilité haute ou critique non justifiée.
- Inventaire des licences **généré au build**, avec une liste de licences acceptées (MIT,
  ISC, BSD-2/3-Clause, Apache-2.0, MPL-2.0) ; le build échoue sur une licence hors liste.
- Build à l'installation ou artefact versionné : à trancher au plan selon la
  reproductibilité, l'accès au registre npm et le fonctionnement sur l'autre PC et la VM
  cloud. La recommandation par défaut est le build dans Docker pendant `install.sh`.

### RNF-5 — Qualité

- pre-commit étendu : prettier, eslint (règles React hooks et TypeScript, configuration
  cible à préciser au plan), vérification de types. Le hook pre-commit ne doit pas dépasser
  environ 20 s sur un changement courant.
- Suite Playwright lancée par une commande documentée, en dépendance de dev uniquement :
  elle ne fait pas partie de l'installation.

### RNF-6 — Réversibilité (corrige la contradiction relevée en M2)

- Pendant le développement, `frontend/` et le service `web` actuel (`nginx:1.29-alpine`,
  montage en lecture seule) restent intacts sur `develop`.
- La bascule remplace, dans `compose.yaml`, le montage de `frontend/` par l'image nginx qui
  embarque le build. La configuration actuelle reste disponible par une surcharge compose
  dédiée (ou un profil). **Retour arrière** : une seule commande documentée qui redémarre
  `web` sur l'ancienne interface, **testée au moins une fois avant le merge**. En dernier
  recours, revert du merge.
- `frontend/` n'est supprimé qu'après une période d'observation sans régression (durée à
  fixer, deux semaines proposées), dans une branche séparée.

## Contraintes

- Contrats `/v1/realtime`, `/api/*`, `/voices/`, `/config.json` inchangés ; moteur,
  routeur, RAG et voix hors périmètre.
- API navigateur (AudioWorklet, Web Audio, WebSocket, `getUserMedia`, WebGL,
  `localStorage`, `window.print`) : la logique reste isolée du cycle de rendu React et
  supporte le double montage du mode strict.
- `capture-worklet.js` est servi tel quel, hors bundle.
- GitFlow : `feature/*` depuis `develop`, après la soutenance et le merge de
  `feature/repetition`. Pendant le big-bang, l'interface actuelle est gelée : seuls les
  correctifs urgents y sont faits (`bugfix/*`), puis reportés sur la branche de migration.
- Aucun modèle en dur dans `compose.yaml`.

## Hors-scope

- Nouvelles fonctionnalités (archive, historique) ; chargement à la demande de three.js
  (amélioration Could, hors parité).
- Toute modification du moteur s2s, du routeur, du RAG ou des voix.
- Refonte graphique au-delà de la maquette validée ; internationalisation ; CI distante.

## Dépendances

| Module / Service                              | Nature de la dépendance                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| `deploy/s2s/compose.yaml` (`web`)             | Image avec le build à la place du montage ; surcharge de retour arrière   |
| `deploy/s2s/nginx.conf.template`              | Racine servie, CSP (décision du spike)                                    |
| `deploy/s2s/install.sh`                       | Étape de build frontend (en ligne, une fois)                              |
| `check-local.sh`, `smoke-test.sh`, `share.sh` | Doivent passer à l'identique ; ngrok à revérifier                         |
| `.pre-commit-config.yaml`, `eslint.config.js` | Extension à TS, React et Tailwind                                         |
| `frontend/vendor/`                            | Remplacé par des paquets npm aux mêmes versions (three 0.160.1 à valider) |
| `feature/repetition`                          | Doit être mergée avant le démarrage                                       |

## Risques

| Risque                                                                                                                                                  | Prob.            | Impact | Mitigation                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------ | ----------------------------------------------------------- |
| Styles injectés à l'exécution par les dépendances shadcn (Radix Dialog via `react-remove-scroll`, notifications Sonner), bloqués par `style-src 'self'` | Haute            | Haut   | Porte du spike, critères écrits, composants de remplacement |
| Régression de latence ou de capture (mode strict, cycle de vie)                                                                                         | Moyenne          | Haut   | Logique hors rendu ; mesure navigateur avant/après          |
| Fuites `AudioContext` / WebGL / WebSocket                                                                                                               | Moyenne          | Moyen  | Critère RF-2 (dix appels successifs)                        |
| Requêtes externes (polices, télémétrie)                                                                                                                 | Faible avec Vite | Haut   | Playwright hors ligne, recherche d'URL dans le build        |
| Chaîne d'approvisionnement npm (scripts, paquets retirés)                                                                                               | Moyenne          | Haut   | Lockfile, `--ignore-scripts`, audit, image épinglée         |
| Collision entre le preflight Tailwind et la fidélité visuelle                                                                                           | Moyenne          | Moyen  | Maquette validée pendant le spike                           |
| PDF de répétition dégradé                                                                                                                               | Moyenne          | Moyen  | Comparaison avec un PDF de référence                        |
| Gel prolongé de l'interface                                                                                                                             | Moyenne          | Moyen  | Démarrage après la soutenance ; correctifs urgents reportés |
| Dérive de l'effort                                                                                                                                      | Moyenne          | Moyen  | Estimation révisée après le spike                           |

## Estimation révisée

**Hypothèses** : TypeScript ; identité visuelle actuelle transposée dans les variables de
thème shadcn ; Playwright inclus ; une personne. **Base de calcul** : environ 400 lignes par
jour pour la logique UI à réécrire en composants React typés, environ 800 lignes par jour
pour le code impératif simplement encapsulé (three.js, worklet, filtre de bruit). Les
2 413 lignes de CSS et les 820 de HTML sont réparties dans les lots qui les utilisent.

| Lot                                                                                 | Volume source  | Jours             |
| ----------------------------------------------------------------------------------- | -------------- | ----------------- |
| Spike (porte go/no-go, maquette, boucle de dev)                                     | page témoin    | 1,5 – 2           |
| Grille de parité, suite Playwright, mesures de référence                            | ~30 parcours   | 2 – 3             |
| Socle : Vite, TS, Tailwind, shadcn, thème, Docker multi-stage, pre-commit, licences | —              | 2 – 3             |
| Appel temps réel : `app.js`, picker, render, web, attachments, noise-gate           | ~1 800 lignes  | 4 – 5             |
| Avatars : orb, face3d, avatars3d, avatar (encapsulation)                            | ~1 970 lignes  | 2 – 3             |
| Fenêtres : settings, connections, services, agents, knowledge, ragprojects          | ~1 790 lignes  | 4 – 5             |
| Répétition et impression PDF                                                        | ~1 330 lignes  | 3 – 4             |
| Validation (parité, latence, hors ligne, PDF), retour arrière testé, doc, ADR       | —              | 2 – 3             |
| **Total**                                                                           | ~10 200 lignes | **20,5 – 28 j-h** |

Marge : +20 % si l'utilisateur exige une fidélité visuelle au pixel, ou si le spike
impose de remplacer des composants shadcn. L'estimation sera revue en sortie de spike.

## Questions ouvertes restantes (à trancher au plan ou au spike)

1. Confirmer TypeScript (D4).
2. Seuil de latence (+50 ms sur la médiane proposé) et nombre d'appels mesurés (20 proposé).
3. Build Docker à l'installation ou artefact versionné (RNF-4).
4. Nom du répertoire du nouveau code (`web/` proposé) et durée d'observation avant
   suppression de `frontend/` (deux semaines proposées).
5. Fidélité visuelle : tranchée sur la maquette du spike.
6. Décision CSP sur `style-src` : tranchée sur le rapport du spike, selon les critères
   ci-dessus.
