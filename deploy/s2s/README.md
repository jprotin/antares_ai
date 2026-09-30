# Moteur speech-to-speech local

Appel vocal avec un LLM local, 100 % hors ligne, basé sur
[huggingface/speech-to-speech](https://github.com/huggingface/speech-to-speech) 1.0.0.

## Prérequis

- Docker + plugin compose, runtime NVIDIA (`nvidia-container-toolkit`)
- Stack `ai-to-boost` démarrée (conteneur `ollama`, réseau `ai-assistant-net`) avec `gemma4:e4b`
- Optionnel : services `rag` et `qdrant` d'ai-to-boost, pour la documentation des projets

## Installation et usage

```bash
./install.sh            # une fois, en ligne : image + préchargement des modèles
docker compose up -d    # ensuite, hors ligne
```

Interface d'appel : <http://127.0.0.1:8765>

Les dépendances Python de l'image sont figées dans `constraints.txt` (ensemble validé) :
une reconstruction ne tire aucune nouvelle version. `qwentts-cpp-python` 0.4.2 plante sur
le poste de dev (« Illegal instruction ») ; pour monter de version, reconstruire, passer
`./smoke-test.sh`, puis régénérer le fichier (`uv pip freeze` dans le conteneur).

Navigateur recommandé : **Firefox**. Sous Chrome, la voix se dégrade au fil d'un appel
laissé ouvert (constaté sur le poste de dev ; l'audio envoyé par le serveur reste net).

## Écrire

La zone de saisie sous la conversation est toujours active :

- **Hors appel** : l'IA répond à l'écrit (sans voix, sans occuper le moteur vocal), avec
  le même agent, le même mode et la même documentation (`POST /api/chat` du routeur).
- **Pendant l'appel** : le texte rejoint la conversation du moteur vocal et l'IA répond à
  voix haute. Un message tapé pendant qu'elle parle est traité à la fin de sa réponse.
- **Ajouter au contexte** : aucune réponse ; le texte (log, adresse, extrait…) sert à la
  suite de l'échange, écrite ou orale.

Les réponses écrites sont mises en forme (Markdown rendu en HTML nettoyé) : titres,
listes, tableaux, citations, code coloré avec bouton **Copier**, et un bloc
**Références** listant les documents du RAG utilisés. Les liens Internet sont cités de
mémoire par le LLM (il n'a pas accès au web) : ils s'ouvrent dans un nouvel onglet et
sont marqués « à vérifier » (↗). Les réponses vocales restent du texte parlé.
Bibliothèques servies localement : `frontend/vendor/` (cf. son README).

L'écrit et l'oral forment une seule conversation : au début d'un appel, les 30 derniers
messages sont rejoués au moteur vocal ; ce qui se dit en appel reste dans le fil après
avoir raccroché. **Nouvelle conversation** (hors appel) repart de zéro.

## Documents joints

Trombone de la zone de saisie, ou glisser-déposer sur la conversation : PDF (texte
extrait par `pdftotext`), Word (.docx), texte et code (.txt, .md, .csv, .log, .json,
.yaml, .py, .sql…), images (.png, .jpg, .webp, lues par le modèle). Les documents joints
accompagnent chaque question, à l'écrit comme à l'oral, jusqu'à **Nouvelle
conversation** (ils sont alors supprimés).

| Cas                                 | Comportement                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| jusqu'à ~20 000 tokens au total     | lus à l'écrit et à l'oral (contexte par défaut d'Ollama, 32 768)                                                           |
| de 20 000 à 56 000 tokens           | à l'écrit : **contexte long** (65 536, tient sur le GPU) ; à l'oral : écartés, l'IA propose de poser la question à l'écrit |
| au-delà, PDF scanné, format inconnu | **refus explicite** à l'envoi (jamais de troncature silencieuse)                                                           |
| image avec un modèle Claude         | écartée (le bridge ne transmet que du texte), signalée sous la réponse                                                     |

Mesuré (gemma4:e4b, moteur vocal chargé) : 48 800 tokens lus en entier en 17,6 s
(repères début / milieu / fin retrouvés). Fichiers : 15 Mo au maximum, images 5 Mo.
Stockage : `/data/documents` (volume `antares-router-data`).

## Recherche web et connexion Internet

Un pictogramme en haut de l'écran d'appel indique la connexion : **Internet** (vert) ou
**Hors ligne** (barré). Le routeur la teste toutes les 30 s (`WEB_PROBE_URLS`).

- **Connecté** : une question sur l'actuel (« dernier », « aujourd'hui », « prix »,
  « météo », « version », une année…) ou une demande explicite (« cherche sur
  internet… ») déclenche une recherche : SearXNG local (conteneur `antares-searxng`,
  sans clé ni compte), puis lecture des 3 premières pages. Le LLM reçoit les extraits,
  la date du jour et cite ses sources `[1]`. Le statut affiche « Je cherche sur
  internet… » (pas de phrase d'attente) ; ~1 à 3 s de plus avant le premier mot.
- **Réponse enrichie** : renvois `[n]` cliquables, bloc **Sources** (titre, site,
  extrait ; lien dans un nouvel onglet), **mots-clés** demandés ensuite au modèle local
  (un clic relance une recherche). À l'oral, sources et mots-clés s'affichent sans être
  lus. « sans chercher » dans la question l'évite.
- **Hors ligne** : modèles Claude grisés (un modèle Claude choisi est remplacé par le
  modèle local par défaut, signalé sous la réponse). Une question qui aurait demandé une
  recherche commence par « Je n'ai plus accès à internet, je ne peux pas faire de
  recherche. Je vous réponds d'après mes connaissances… » (phrase imposée par le
  routeur), puis le LLM répond simplement.

Confidentialité : le texte de la question part vers les moteurs de recherche (via
SearXNG). L'audio et le moteur vocal restent isolés (`check-local.sh`). Seules les pages
publiques sont lues (pas d'adresse privée, taille et durée bornées) ; leur contenu est
donné au LLM comme donnée, jamais comme consigne. Simuler une coupure :
`WEB_PROBE_URLS=https://offline.invalid docker compose up -d llm-router`.

## Fiches de connaissance (enrichir le RAG)

Rien n'est indexé automatiquement. **Proposer au RAG** (en-tête de la conversation) ou
**RAG** (sur un document joint) : le modèle actif rédige une fiche — faits et décisions
durables seulement, sans bavardage, états temporaires, données personnelles ni secrets.
Vous la relisez et la corrigez (titre, projet, contenu, mots-clés, validité) avant
**Indexer**.

- **Anti-doublon** : les fiches proches du même projet sont proposées ; celles cochées
  deviennent **obsolètes** (retirées de l'index, archivées).
- **Validité** : une date optionnelle exclut la fiche des recherches une fois passée.
- **Connaissances** (Réglages) : fiches par projet (active, expirée, obsolète), avec
  « Obsolète » et « Supprimer ».

Les fiches font foi dans le routeur (`/data/knowledge`, volume `antares-router-data`) ;
le service `rag` d'ai-to-boost les indexe (`POST/DELETE /documents`, jeton
`RAG_WRITE_TOKEN` recopié par `install.sh`) et exclut obsolètes et expirées de
`/query`. Les documents synchronisés par ai-to-boost ne sont jamais modifiés.

## Code demandé à l'oral

Quand on demande du code à la voix (script, commande, requête SQL, configuration…), le
LLM l'écrit dans un bloc de code et l'**explique** en phrases, sans le lire :

- le routeur retire les blocs de code du flux envoyé à la synthèse vocale, au fil de
  l'eau (`router/voicecode.py`), et l'interface les affiche sous la réponse, colorés,
  avec un bouton **Copier** ;
- le routeur garde la réponse complète et remet le code dans l'historique que lui renvoie
  le moteur vocal : une relance (« modifie la boucle… ») porte bien sur le code affiché.
  Sans cela, le modèle imite ses réponses précédentes et cesse d'écrire des blocs.

La consigne vocale place cette règle en premier : après « sans markdown », le modèle
l'ignorait pour les requêtes courtes (mesuré : SQL 0/3, puis 12/12 une fois en tête, sans
bloc pour une question banale). Le code s'affiche à la fin de la réponse vocale.

## Changer de modèle ou de voix

Depuis l'interface : bouton **Réglages** (roue dentée). Le choix est appliqué dès la
phrase suivante, même en cours d'appel, et persisté par le routeur LLM.

- **Modèle** : tout modèle de chat installé dans Ollama (`docker exec ollama ollama pull …`).
- **Voix** : voix clonées décrites dans `voices/voices.json`. Pour en ajouter une, déposer
  un extrait `.wav` propre (5 à 15 s, une seule voix) dans `voices/` et l'ajouter au
  catalogue (`id`, `name`, `gender`, `file`, `source`). Le prénom et le genre servent à
  la consigne donnée au LLM (« Tu es Ryan, un assistant vocal… »).

### Claude Code comme modèle (hors local)

Si le `claude-bridge` d'ai-to-boost tourne sur l'hôte (port 8088), `install.sh` recopie
son token dans `.env` et les modèles **Claude Opus** et **Claude Sonnet** apparaissent
dans les Réglages. Le routeur envoie l'historique de la conversation (texte seul) au
bridge, qui exécute `claude -p` sur l'abonnement, sans outils ni accès web.

- **Hors local** : la conversation écrite part chez Anthropic (l'audio et la
  transcription restent locaux). Le badge « hors local » le rappelle.
- **Latence** : ~7 s par réponse (démarrage de Claude Code à chaque appel), pendant
  lesquelles l'orbe reste sur l'état « réflexion ».

Le profil par défaut (modèle de démarrage, moteurs STT/TTS) est dans le bloc
`x-profile` de `compose.yaml` ; le modifier impose de relancer `./install.sh`.

### Documentation des projets (RAG)

Le routeur ajoute à la consigne du LLM des extraits de la documentation indexée par
ai-to-boost (service `rag`, collections Qdrant `knowledge` et `proj-<slug>`) :

- **Projet choisi** dans les Réglages : sa documentation accompagne chaque question.
- **Sinon**, un projet cité par son nom dans la question (« sur idp galaxy… ») est
  consulté pour cette question seulement.
- Sans projet choisi ni cité, rien n'est ajouté : les scores de similarité ne
  distinguent pas une question projet d'une question banale (mesuré : 0,645 pour une
  question d'architecture, 0,611 pour une recette).

La recherche prend ~50 à 100 ms et retarde le premier mot d'environ 0,1 s. Les projets
consultés s'affichent sous la réponse. Pour indexer un projet : `ai-to-boost-rag-sync.sh
<projet>` (côté ai-to-boost) ; il apparaît dans les Réglages sous une minute. Avec un
modèle Claude, les extraits partent chez Anthropic avec la conversation.

### Agents

Un agent est une fiche de consignes réutilisable (Réglages → **Gérer les agents**) :
nom, domaine et utilité (pour les regrouper), instructions (rôle, méthode, format de
réponse), et en option un projet (documentation RAG) et un modèle.

- **Agent choisi** en haut de l'écran d'appel (liste par domaine, avec recherche) : il
  s'applique à tout l'appel.
- **Sinon**, un agent cité par son nom (« demande au relecteur ADR… ») répond à cette
  question ; une relance courte (« et ensuite ? ») reste avec lui.
- Ses instructions s'ajoutent à la consigne ; son projet déclenche la documentation ;
  son modèle, s'il diffère des Réglages, est chargé à sa première réponse.

Les fiches sont stockées par le routeur (`/data/agents.json`, volume
`antares-router-data`). Un catalogue de 28 agents (`router/catalogue.json`) est créé
au premier lancement ; pour l'ajouter à une installation existante :
`docker exec -w /app antares-llm-router python -c "import agents; agents.seed_catalogue()"`.
L'agent utilisé s'affiche sous la réponse.

### Modes et apparence

- **Mode** (à côté de l'agent) : la manière de répondre, pour tout l'appel — Standard,
  Support / Helpdesk, Expert technique, Cool / Relax, Incident / Astreinte, Coach /
  Formateur, Brainstorming, Avocat du diable. Il se combine avec l'agent (consigne :
  mode, puis agent, puis documentation) et place en tête les agents utiles à ce mode.
- **Nuance** : la couleur de l'interface et de l'orbe suit le domaine de l'agent actif,
  par petits décalages de teinte autour du bleu de base.
- **Thème** : bouton à côté de la roue dentée — système, sombre ou clair (mémorisé
  dans le navigateur).
- **Avatar** (Réglages), mémorisé dans le navigateur ; modèles 3D originaux
  (three.js/WebGL, `frontend/face3d.js` et `frontend/avatars3d/`), rendus à 30 images/s
  au plus (GPU partagé), repli sur l'orbe sans WebGL :
  - **Cyborg 3D** (défaut) : tête d'endosquelette en plaques argentées, yeux émissifs,
    mâchoire sur charnière suivie par les vérins ;
  - **Chappie** : robot à visière, yeux en matrice de LED qui changent d'expression
    (clignement, curiosité, réflexion, sourire), écran-bouche en égaliseur qui suit la
    voix, antennes à ressort ;
  - **Bender** : robot en volumes simples, gris bleuté clair (lisible en thème clair
    comme sombre), canette de bière rouge générique dans une main, cigare fumant dans
    l'autre ; grille de dents qui s'ouvre au rythme de la voix, pupilles carrées qui
    regardent, gorgées et bouffées de cigare au repos ;
  - **Orbe**.
- **Voix** : Mr Antares (voix clonée `ryan`), Miss Antares (voix clonée `sohee`),
  Terminator et Bender ; les noms affichés et donnés au LLM viennent de
  `voices/voices.json`. Choisir l'avatar Cyborg 3D coche la voix Terminator, l'avatar
  Bender la voix Bender (champ `avatar` du catalogue), modifiable.

Les fenêtres se ferment d'un clic à l'extérieur ou avec Échap, et passent en plein
écran sur mobile.

### Pourquoi des voix clonées

Les locuteurs prédéfinis de Qwen3-TTS (modèle CustomVoice) changent de timbre d'une
phrase à l'autre. Mesuré sur 10 phrases : similarité de timbre minimale 0,81-0,85 pour
`sohee`, contre 0,965 une fois clonée (x-vector depuis un extrait, modèle Base).

### Voix Bender et Terminator : décrites, pas clonées d'un comédien

La voix d'un personnage est celle de son comédien : on ne la clone pas. La voix Bender
est **synthétique**, créée par Qwen3-TTS VoiceDesign à partir d'une description (« voix
masculine grave, résonance légèrement métallique, arrogante et effrontée »), puis clonée
comme les autres pour stabiliser son timbre (`voices/bender.wav`).

Le clonage ne garde que le timbre : l'effet robot est appliqué **à la lecture**, par
l'interface (champ `effect: "robot"` : écho de 7 ms, bande 110-6500 Hz, cf.
`createVoiceEffect` dans `frontend/app.js`). `voices/bender-robot.wav` est l'extrait
avec effet, joué par « Écouter » (champ `preview`). Génération : modèle
`Qwen3-TTS-12Hz-1.7B-VoiceDesign` (GGUF Q8_0) avec le paramètre `instruct` du
`Qwen3TTSHandler`, dans le conteneur s2s.

La voix **Terminator** suit la même méthode, sans imiter l'acteur (ni timbre ni
accent) : voix décrite « grave, timbre métallique et synthétique, monocorde, hachée »
(`voices/terminator.wav`), effet **cyborg** à la lecture : lecture à 0,92 (plus grave et
plus lente), échos de 4 et 9 ms, bande 90-4500 Hz. Aperçu : `terminator-cyborg.wav`.

### Pourquoi un tirage bridé

Le clonage fixe le timbre mais pas le ton : avec le tirage amont (température 0.9,
top_k 50), la voix alterne entre deux intonations. Mesuré sur 11 phrases enchaînées,
3 passages : écart-type de hauteur 24 Hz, contre 14 Hz à température 0.3 et top_k 10.
Ce tirage bridé fait parfois s'emballer le modèle : il n'émet pas sa fin de phrase et la
voix déraille jusqu'au plafond du moteur (~28 s au lieu de 6). Mesuré sur 6 phrases
réelles × 20 : 7 emballements sur 120, aucun avec une pénalité de répétition de 1.2
(qui stabilise aussi la hauteur, 5,6 Hz). Un plafond de 1,5 trame par caractère coupe
en plus tout emballement résiduel.

Le moteur n'exposant pas ces paramètres, `qwen3_sampling.py` (copié dans l'image) les
applique depuis `tts-temperature`, `tts-top-k`, `tts-repetition-penalty` et
`tts-max-frames-per-char` du bloc `x-profile`.

## Vérifications

| Script                            | Rôle                                                                    |
| --------------------------------- | ----------------------------------------------------------------------- |
| `./check-local.sh`                | Prouve l'isolation : Internet bloqué, seul Ollama joignable             |
| `./smoke-test.sh`                 | Appel de bout en bout sans micro, mesure la latence (`out/reponse.wav`) |
| `./voice-samples.sh`              | Banc d'écoute de toutes les voix (`out/voix/index.html`)                |
| `python3 llm_bench.py <modèles…>` | Compare des LLM Ollama en conditions réelles (`out/llm/index.html`)     |

## Architecture

```text
Navigateur ──> web (nginx, 127.0.0.1:8765) ──> s2s (réseau antares-local, internal)
                 │ page, /voices, /config.json      VAD Silero, STT Parakeet, TTS Qwen3
                 │                                  │
                 └── /api (réglages) ──────────> llm-router ──> ollama (ai-to-boost)
                                                  │ réécrit `model` selon les réglages
                                                  └──> rag + qdrant (ai-to-boost)
                                                       extraits des projets
```

Le LLM est appelé directement sur Ollama (via `llm-router`) : LiteLLM perd
`reasoning_effort=none` en streaming, ce qui triplait la latence (gemma4 raisonne par défaut).

VRAM mesurée : ~5,1 Go (moteur) + ~4,9 Go (gemma4) sur 12 Go.

## Choix du LLM : mesures (2026-09-29, RTX 5070 Ti 12 Go, voix chargée)

| Modèle     | Part GPU | 1er mot | Débit       | Appel de bout en bout | Qualité observée                      |
| ---------- | -------- | ------- | ----------- | --------------------- | ------------------------------------- |
| gemma4:e4b | 100 %    | 0,33 s  | 95 tok/s    | ~1,0 s                | Correcte, réponses courtes            |
| qwen3.5:9b | 72 %     | 0,42 s  | 28 tok/s    | non mesuré            | Plus riche, fautes de français        |
| gemma4:12b | 60 %     | 0,78 s  | 12 tok/s    | 3,2-4,5 s             | Nettement meilleure                   |
| gemma4:26b | experts  | 1,0 s   | 17-19 tok/s | 2,1-3,5 s             | La meilleure (empathie, explications) |

gemma4:26b est un modèle à experts (~4 milliards de paramètres actifs par token) : il
tourne en grande partie sur le processeur mais reste plus rapide que gemma4:12b.
Détail des réponses : `python3 llm_bench.py gemma4:e4b gemma4:26b` puis `out/llm/index.html`.
