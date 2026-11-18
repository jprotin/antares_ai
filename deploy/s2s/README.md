# Moteur speech-to-speech local

Appel vocal avec un LLM local, 100 % hors ligne, basé sur
[huggingface/speech-to-speech](https://github.com/huggingface/speech-to-speech) 1.0.0.

## Prérequis

- Docker + plugin compose, runtime NVIDIA (`nvidia-container-toolkit`)
- Stack `ai-to-boost` démarrée (conteneur `ollama`, réseau `ai-assistant-net`) ; le modèle
  de langage se choisit ensuite dans l'interface (Réglages, Connexions)
- Optionnel : services `rag` et `qdrant` d'ai-to-boost, pour la documentation des projets

## Installation et usage

```bash
./install.sh            # une fois, en ligne : image + préchargement des modèles
docker compose up -d    # ensuite, hors ligne
```

Interface d'appel : <http://127.0.0.1:8765>

### Interface : nouvelle (`web/`) ou ancienne (`frontend/`)

L'interface servie est construite depuis `web/` (Vite + React, ADR 0012) dans l'image
`antares/web`, par `install.sh` (étape en ligne, npm). L'ancienne interface (`frontend/`)
reste disponible pendant la période d'observation :

```bash
./ui.sh legacy          # ancienne interface (1 s, sans construction, hors ligne)
./ui.sh new             # nouvelle interface ; reconstruit l'image si elle est périmée
./ui.sh new --build     # reconstruction forcée
```

- Le choix persiste dans `.env` (`COMPOSE_FILE`) : `docker compose up -d` et `install.sh`
  le conservent.
- Après un `git pull` qui touche `web/`, lancer `./ui.sh new` : `docker compose up -d`
  seul ne reconstruit pas l'image. L'image servie porte l'empreinte de `web/` dans
  `/version.json` (champ `rev`), et `ui.sh new` la compare à celle du dépôt.
- Construction impossible (pas de réseau, registre npm injoignable) : `ui.sh new` échoue
  sans rien changer (interface et `.env` en place) ; `install.sh` échoue avec un message
  explicite, et `./ui.sh legacy` sert l'ancienne interface en attendant.
- Machine sans registre npm : `docker image save antares/web:latest | gzip > web.tar.gz`
  sur une machine en ligne, puis `docker image load < web.tar.gz`.
- Retour arrière de niveau 2 (annuler la migration dans le dépôt) : `git revert -m 1` du
  merge sur une branche `bugfix/*` ou `hotfix/*`, puis `./ui.sh legacy`. Pour reprendre
  la migration ensuite, annuler d'abord ce revert (`git revert <commit du revert>`).
- Tests de l'interface : `cd ../../web && npm run test:e2e:mock` (voir `web/README.md`) ;
  `check-local.sh` et `smoke-test.sh` ne vérifient pas l'interface.

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
Bibliothèques embarquées dans l'image de l'interface (versions exactes dans
`web/package.json`, licences dans `/THIRD-PARTY-LICENSES.txt`).

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

## Répéter une présentation

Bouton **Répéter une présentation** (icône tableau, en haut de l'écran d'appel) : titre,
slides en **PDF** (export depuis PowerPoint, Keynote ou Google Slides ; 80 slides,
15 Mo au plus), public (client exigeant, jury, conférence, comité de direction, ou un
de vos agents), nombre de questions, objectif et durée visée facultatifs.

1. **Discours** : la slide s'affiche en grand, l'avatar à côté ; flèches ← → (ou clic
   sur la slide) pour avancer, chrono et durée visée. L'IA écoute sans répondre.
2. **Questions** : l'IA joue le public et pose ses questions, une à la fois, à partir du
   discours et des slides ; elle relance une fois si la réponse est vague.
3. **Rapport** : note /20 (5 critères sur 4), points forts, à améliorer pas à pas
   (rattaché aux slides), à ne pas dire (citations et reformulations), questions-réponses
   (réponse possible), rythme (durée, débit, temps par slide). L'avatar le lit section par
   section (bouton **Écouter** sur chaque section) ; **Imprimer / PDF** pour le garder.

4. **Discuter de la note** (bouton du rapport) : volet à droite, à l'écrit ou avec
   **Parler**. Expliquez un contexte que le coach ignorait ou signalez une erreur : il
   peut revoir une note d'un point par critère (par rapport à la note d'origine), à la
   hausse comme à la baisse ; une simple contestation ne change rien. Le rapport affiche
   « Note révisée (initialement …) · Voir l'historique » ; l'impression ajoute les
   révisions en annexe.

**Micro pendant la répétition** : 3 s de silence au début pour mesurer le bruit de la
pièce ; en dessous du seuil, rien n'est envoyé au moteur (indicateur « Voix captée /
Bruit filtré » et réglage **Filtre du bruit** Léger / Normal / Fort, mémorisé dans le
navigateur). Le micro est coupé tant que l'avatar parle : bouton **Interrompre** pour
l'arrêter.

Le rapport est rédigé par le modèle choisi dans les Réglages (Claude : le discours sort
de la machine). Historique et progression des notes dans la même fenêtre ; stockage
`/data/rehearsals` (volume `antares-router-data`). Détails : ADR 0011.

## Partager avec un collègue (ngrok)

Accès distant temporaire, en HTTPS (le micro exige une page sécurisée), par un tunnel
ngrok dans un conteneur (`ngrok/ngrok`, version figée). Une fois, ajouter son jeton
([dashboard ngrok](https://dashboard.ngrok.com/get-started/your-authtoken)) dans
`deploy/s2s/.env`, avec un éditeur (pas dans l'historique du shell) :
`NGROK_AUTHTOKEN=…`. Ensuite :

```bash
./share.sh collegue@gmail.com      # une ou plusieurs adresses Google autorisées
```

Le script affiche l'URL à envoyer ; Ctrl+C ferme le partage.

- **Accès** : connexion Google obligatoire, puis refus de toute adresse non listée
  (traffic policy ngrok, générée à chaque partage). `SHARE_OWNER_EMAIL=ton@adresse`
  dans `.env` t'ajoute d'office : par le tunnel, tu gardes la veille complète, les
  autres invités la lisent seulement (ngrok transmet l'adresse Google de chacun dans
  l'en-tête `x-antares-user`, après avoir retiré celui du navigateur).
- **Pendant le partage** : Claude (ton abonnement) et l'écriture dans le RAG (fiches)
  sont désactivés pour tout le monde ; le pictogramme de connexion affiche
  « Internet · partagé ». Tout revient à la normale à la fermeture.
- **À savoir** : un seul appel vocal à la fois (le moteur n'a qu'une place) ; les
  réglages (avatar et voix côté serveur, modèle, agent, mode, projet) sont communs ;
  le RAG reste consultable ; le trafic de l'invité (voix, texte) transite déchiffré
  par ngrok. Ton usage en local ne passe pas par le tunnel.

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

- **Modèle** : la liste est construite à la volée à partir des **fournisseurs** déclarés
  dans Réglages → **Connexions** (groupée par fournisseur, rafraîchie toutes les 30 s).
- **Voix** : liée à l'avatar (cf. Modes et apparence), voix clonées décrites dans
  `voices/voices.json`. Pour en ajouter une, déposer
  un extrait `.wav` propre (5 à 15 s, une seule voix) dans `voices/` et l'ajouter au
  catalogue (`id`, `name`, `gender`, `file`, `source`, `avatars`). Le nom et le genre servent à
  la consigne donnée au LLM (« Tu es Mr Antares, un assistant… »).
- **Voix personnelles** (sa propre voix clonée, par exemple) : dans `voices/perso/`,
  ignoré par git (donnée biométrique), avec un catalogue local `voices/perso/voices.json`
  de même format. Une voix locale peut hériter d'une voix versionnée (`"base": "bender"` :
  nom, genre, persona) et prend les avatars qu'elle déclare. Le routeur fusionne les deux
  catalogues (`router/voices.py`, servi sous `/voices/voices.json`) ; une voix dont
  l'extrait manque est ignorée, la voix versionnée reprend alors sa place. nginx ne sert
  de `voices/perso/` que les aperçus (`voices/perso/apercu/*.wav`) : le moteur lit les
  extraits sur le disque.

### Connexions : fournisseurs de modèles

Réglages → **Connexions (Ollama, LiteLLM, API…)** : ajouter, tester, modifier ou retirer
un fournisseur. Types :

- **Ollama** (sur cette machine ou ailleurs) : liste native (taille, paramètres),
  préchargement, contexte long pour les documents joints ;
- **API compatible OpenAI** : LiteLLM, vLLM, OpenAI, Mistral, Groq… (`GET /models`,
  `POST /chat/completions` ; l'adresse inclut `/v1`).

Chaque modèle s'appelle `<fournisseur>/<modèle>` (ex. `ollama/gemma4:e4b`,
`litellm/local-gemma`) ; les anciens noms sans fournisseur désignent `ollama`. Un
fournisseur déclaré **hors local** (case décochée) est signalé comme tel, et ses
modèles sont coupés hors ligne et pendant un partage (repli sur le modèle de repli).
« Tester » affiche la latence et les modèles trouvés, ou l'erreur.

Aucun modèle n'est figé dans `compose.yaml`. Le **modèle de repli** se choisit dans
Connexions parmi les modèles des fournisseurs actifs (hors Claude) ; il remplace le
modèle choisi quand celui-ci est indisponible (hors ligne, partage, fournisseur
injoignable) et sert tant qu'aucun modèle n'est choisi. Non réglé, le routeur prend le
premier modèle disponible, local d'abord : à régler, ce peut être un modèle trop gros
pour la VRAM. Son fournisseur ne peut pas être supprimé.

**Couper le raisonnement** (option par fournisseur, cochée par défaut s'il est local) :
gemma4 et qwen3 « réfléchissent » en silence si on ne le leur interdit pas. Via LiteLLM,
qui retire `reasoning_effort` (`drop_params`), c'était 3 à 30 s avant le premier mot ;
l'option envoie `reasoning_effort: none` en l'autorisant explicitement
(`allowed_openai_params`), et LiteLLM retombe à 0,3 s comme Ollama direct (mesuré).
À décocher pour une API externe qui refuserait le paramètre. « Tester » mesure aussi le
premier mot et signale un modèle qui réfléchit ou trop lent.

En local, **Ollama direct** reste le meilleur chemin : LiteLLM sert les mêmes modèles, il
n'apporte rien de plus ici ; il est utile pour regrouper des API externes et leurs clés.
Sur 12 Go de VRAM, gemma4:26b (18,6 Go) déborde sur le processeur et se recharge à
chaque changement de modèle (~18 s).

La configuration est dans `/data/connections.json` (volume du routeur, lisible par lui
seul), initialisée depuis `OLLAMA_URL` au premier lancement. Les clés d'API ne sont
jamais renvoyées à l'interface (« clé définie »). Écriture refusée pendant un partage.

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

### RAG intégré (sans ai-to-boost)

antares embarque son propre RAG (ADR 0010) : même API et mêmes embeddings que celui
d'ai-to-boost, embeddings sur le processeur (pas de VRAM, ~2 Go de RAM), sans accès
Internet. Les deux RAG sont séparés ; on passe de l'un à l'autre dans Connexions.

```bash
echo COMPOSE_PROFILES=rag-integre >> .env   # posé par install.sh si ai-to-boost est absent
docker compose up -d                        # démarre antares-rag et antares-qdrant
```

Puis Connexions → RAG → **RAG intégré à antares**, et Réglages → Projet → **Projets du
RAG intégré** : créer un projet, y déposer des documents (Markdown, texte, code, PDF,
Word ; 15 Mo et 200 000 caractères au plus par fichier). Pour un dossier entier :

```bash
./rag-index.sh mon-appli ~/dev/mon-appli    # .md, .txt, .pdf, .docx, hors .git et cachés
```

Mesuré : 11 ADR (98 extraits) indexés en 29 s ; recherche en ~30 ms.

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
  - **Terminator** (défaut) : tête d'endosquelette en plaques argentées, yeux émissifs,
    mâchoire sur charnière suivie par les vérins ;
  - **Chappie** : robot à visière, yeux en matrice de LED qui changent d'expression
    (clignement, curiosité, réflexion, sourire), écran-bouche en égaliseur qui suit la
    voix, antennes à ressort ;
  - **Bender** : robot en volumes simples, gris bleuté clair (lisible en thème clair
    comme sombre), canette de bière rouge générique dans une main, cigare fumant dans
    l'autre ; grille de dents qui s'ouvre au rythme de la voix, pupilles carrées qui
    regardent, gorgées et bouffées de cigare au repos ;
  - **Orbe Antares**.
- **Voix** : elle suit l'avatar (champ `avatars` de `voices/voices.json`) — Terminator
  → Terminator, Chappie → Chappie, Bender → Bender ; seul **Orbe Antares** laisse
  choisir entre Mr Antares (voix clonée `ryan`) et Miss Antares (voix clonée `sohee`).
  Le nom affiché et donné au LLM est celui de la voix. L'avatar est mémorisé dans le
  navigateur, la voix côté serveur : au chargement, la voix est réalignée sur l'avatar.

- **Caractère des personnages** (champ `persona` de `voices/voices.json`) : il s'ajoute
  à l'agent et au mode et donne le ton, sans changer l'exactitude des réponses (l'agent
  décide du fond, le mode de l'attitude, le personnage de la façon de parler) :
  - **Terminator** : machine en mission, chaque demande est une cible à neutraliser,
    obéissance totale à son « commandant » (vouvoyé), ton froid et un peu menaçant
    envers les problèmes, jamais envers l'utilisateur ;
  - **Bender** : imbu de lui-même, insolent, drôle et fêtard, jurons légers seulement
    (pas de gros mots ni d'insulte blessante) ;
  - **Chappie** : très gentil et curieux, avide d'apprendre, tutoie « mon vénérable
    créateur » comme un fils ;
  - **Mr et Miss Antares** (Orbe Antares) : assistant bienveillant, sans caractère
    ajouté.

  À l'oral, le caractère reste bref (trois à cinq phrases, une ou deux touches).

Les fenêtres se ferment d'un clic à l'extérieur ou avec Échap, et passent en plein
écran sur mobile.

### Pourquoi des voix clonées

Les locuteurs prédéfinis de Qwen3-TTS (modèle CustomVoice) changent de timbre d'une
phrase à l'autre. Mesuré sur 10 phrases : similarité de timbre minimale 0,81-0,85 pour
`sohee`, contre 0,965 une fois clonée (x-vector depuis un extrait, modèle Base).

### Voix Bender, Terminator et Chappie : décrites, pas clonées d'un comédien

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

La voix **Chappie** : robot jeune adulte décrit (« environ 25 ans, hauteur moyenne,
claire et amicale, très métallique, articulation robotique »), effet **metal** à la
lecture : échos de 2, 4 et 6 ms, bande 180-6500 Hz. Aperçu : `chappie-metal.wav`.

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

Une voix peut imposer son propre tirage dans `voices/voices.json` ou le catalogue local
(champ `sampling`,
ex. `{"temperature": 0.6, "top_k": 30}`) : il ne vaut que pour elle, les autres gardent
le réglage global. Le catalogue est relu quand il change, sans redémarrer le moteur.
Tests : `test_qwen3_sampling.py` (commande en tête du fichier) et `router/test_voices.py`.

## Veille IA et météo (tâches planifiées)

Le service `antares-tasks` prépare une **veille informatique** à 8 h, 13 h et 18 h (heure
de Paris) : il lit 65 flux RSS et Atom français et anglais (IA, cloud AWS, Azure et
Google Cloud, développement et outils, sécurité, matériel, monde de l'informatique, Hacker
News filtré par mots-clés), dont 4 recherches Google News pour les éditeurs sans flux ou au flux incomplet
(Anthropic, Mistral AI, cloud français, brèves de Korben via `site:korben.info` ; ajouter une recherche = copier une entrée de
`tasks.yaml` et changer `q=`), plus les **sources ajoutées depuis l'interface** (bouton
« Sources » de la veille : site, flux RSS ou sujet Google News, testés avant ajout, 50 au
plus ; les sources fournies s'y désactivent une à une), range les articles selon les votes passés, puis appelle le
modèle deux fois : **une trentaine d'articles à la une** (titre d'origine, catégorie,
langue, extrait du site, une phrase en français, écartée si elle cite un nom absent de l'article ou n'en partage aucun
mot : `digest.check_summaries`) puis **6 idées** de fonctionnalités pour Antares, contrôlées contre
`FEATURES.md` (racine du dépôt) et les idées rejetées. La **météo** (Open-Meteo, sans clé)
est relevée à chaque passage : temps actuel illustré, mini et maxi, pluie, vent et
12 prochaines heures. Tout se lit dans l'interface : bouton « journal » à côté des
Réglages, avec une pastille quand un passage est plus récent que la dernière ouverture ;
fenêtre plein écran, lisible sur téléphone, avec les passages précédents (30 jours gardés).
Les boutons ‹ › passent d'un passage du jour à l'autre (le dernier à l'ouverture) ;
« Toute la journée » les additionne sans doublon dans l'onglet « À la une » ;
l'onglet **« Tous les articles »** liste les articles lus mais non retenus par le modèle
(600 au plus par passage), votables comme les autres. Un clic sur un article ouvre sa
**fiche** (phrase, extrait du site, votes, étoile, lien vers l'original) ; un article en
anglais s'y traduit en français d'un clic (titre et extrait, par le modèle des prompts
d'idées, une seule fois puis gardé dans `veille.db` : `POST
/api/veille/article/<id>/translate`, 180 s laissés par nginx). Le bouton
**« Nouveau passage »** lance une veille complète tout de suite, et **« Statistiques »**
montre vos goûts et les choix de l'IA sur 7 jours, 30 jours ou un an.

```bash
docker compose up -d antares-tasks                      # démarré avec la pile (restart)
docker compose run --rm antares-tasks veille --dry-run  # essai à blanc : rien n'est noté
docker compose run --rm antares-tasks veille            # une veille maintenant
docker compose run --rm antares-tasks meteo             # la météo du jour
docker compose run --rm antares-tasks schedule          # prochains passages, manqués
```

- **Toujours une sous-commande** avec `run` : sans argument, le conteneur ouvrirait une
  seconde boucle planifiée. Un lancement manuel ne prend pas de créneau : le passage
  planifié suivant a lieu normalement.
- **Réglages** dans `tasks/tasks.yaml` (horaires, fuseau, coordonnées, flux, catégories et
  mots-clés, sélection, apprentissage, prompts d'idées, limites), relus au démarrage :
  `docker compose restart antares-tasks` après modification (le routeur relit
  `categories` et `idea_prompt` à chaque requête). Aucun secret. Un flux ajouté se
  vérifie avec `veille --dry-run` : aucune ligne « Flux … indisponible » attendue.
- **Votes** : j'aime / je n'aime pas sur chaque article, intéressé / pas intéressé sur
  chaque idée (`POST /api/veille/vote`). Ils sont enregistrés par le routeur dans
  `veille.db` (volume `antares-router-data`, journal SQLite en mode DELETE pour rester
  lisible depuis un volume en lecture seule) et lus par `antares-tasks` : score des
  candidats par source, catégorie et mots du titre (demi-vie de 30 jours, poids bornés,
  10 % des places réservées aux sources peu notées, 5 aux meilleurs articles de chaque
  catégorie pour qu'aucune ne disparaisse, `limits.candidates_per_category`), derniers
  titres aimés et rejetés montrés au modèle en exemple. Seuls les articles affichés
  deviennent « déjà vus » (adresse et titre : le même article lu dans son flux et par
  Google News n'apparaît qu'une fois) ; un candidat non retenu peut revenir au passage
  suivant tant qu'il a moins de 48 h. Une idée « Pas intéressé » écarte les idées proches.
  Base absente ou illisible : scores neutres, signalé dans le journal.
- **Prompt d'une idée** : au clic « Intéressé », le routeur fait rédiger par le modèle
  un prompt prêt à coller dans Claude Code (`POST /api/veille/idea/<id>/prompt` :
  contexte tiré de `FEATURES.md`, objectif, fichiers probables, démarche, contraintes du
  projet, critères de fin), une seule fois puis gardé en cache dans `veille.db`. Les
  fichiers cités sont pris dans le dépôt monté en lecture seule sous `/repo` (préfixes de
  `idea_prompt.project_map`, voix personnelles exclues) : un nom inventé est écarté.
- **Sources privilégiées** (étoile, dans la fiche d'un article ou dans « Sources », 10 au
  plus, table `favorite_sources` de `veille.db`) : 3 places garanties parmi les candidats
  (`limits.candidates_per_favorite`), en tête de la liste donnée au modèle, et un article
  à la une garanti par passage quand la source en a un (ajouté sans phrase, avec
  l'extrait du site, si le modèle l'a laissé de côté).
- **Passage manuel** (`GET|POST /api/veille/run`) : le routeur dépose une demande
  (table `run_requests` de `veille.db`), antares-tasks la prend en 10 s au plus et note
  l'avancement dans `tasks.db` (`manual_runs`). Un passage à la fois, 5 minutes au moins
  entre deux demandes (429), refusé pendant un appel vocal (409) ; une demande non prise
  en 10 minutes (service arrêté) est abandonnée.
- **Statistiques** (`GET /api/veille/stats?days=7|30|365`, cf. `router/veille_stats.py`) :
  j'aime par catégorie, sources préférées, mots qui reviennent ; articles à la une par
  catégorie et par source, taux de sélection ; par jour, taux d'accord (part de « j'aime »
  parmi les votes sur des articles à la une) et articles ratés (aimés dans « Tous les
  articles »). Le service tient un résumé chiffré par jour (`daily_stats` de `tasks.db`,
  gardé un an) ; chaque vote note si l'article était à la une (`votes.placement`).
- **Articles non retenus** : `GET /api/veille/others?date=AAAA-MM-JJ` (colonne
  `runs.others_json`, extraits de 600 caractères au plus : `limits.extract_chars`, le
  prompt n'en reçoit que `limits.summary_chars`).
- **Sources de l'interface** : `GET|POST /api/veille/sources`, `POST
/api/veille/sources/test` (lecture d'essai), `PATCH|DELETE /api/veille/sources/<id>`,
  `POST /api/veille/sources/builtin` (désactiver une source fournie). Rangées dans
  `veille.db` (tables `sources`, `disabled_sources`), lues par antares-tasks à chaque
  passage. Le routeur lit la source avec le code de collecte du service (monté sous
  `/repo/deploy/s2s/tasks`) : https et adresse publique seulement, y compris pour la
  première adresse ; une page de site est acceptée si elle déclare son flux. Les flux
  d'un même site sont lus l'un après l'autre, à 2 s d'intervalle.
  nginx laisse 180 s à cette route (modèle à charger).
- **Modèle** : vide par défaut, la veille prend le modèle actif des Réglages (celui de la
  voix), ou son repli s'il s'agit de Claude (refusé ici). Fixer un autre modèle dans
  `tasks.yaml` peut faire **recharger Ollama** (latence et mémoire graphique pendant un
  appel) : à éviter sur 12 Go. Le contexte (`num_ctx`) n'est jamais forcé.
- **Appel en cours** : si un tour de conversation date de moins de 2 minutes, la veille
  attend par tranches d'une minute, 15 minutes au plus. Limite connue : un long silence
  pendant un appel n'est pas vu, et une conversation écrite récente reporte aussi la veille.
- **Créneau manqué** (service arrêté, poste en veille plus de 15 minutes) : noté
  « manqué » dans la fenêtre, jamais rattrapé.
- **Réseau** : le service sort vers Internet (flux, Open-Meteo) par `antares-search` et
  joint Ollama par `ai-assistant-net` ; il n'est jamais sur `antares-local`
  (`check-local.sh` le vérifie). Aucun port publié, code monté en lecture seule.
- **Connexions** : le service lit `connections.json` (clés d'API comprises) dans le volume
  du routeur, avec la même image et le même code ; il ne l'écrit jamais. Routeur jamais
  démarré (fichier absent) ou configuration incomplète : passage en échec, message clair.
- **Partage public** (`share.sh`) : la veille reste visible. Les invités la lisent
  (articles, fiches, idées, statistiques, traductions et prompts déjà faits) ; votes,
  étoiles, sources, passage manuel, nouvelles traductions et nouveaux prompts leur
  répondent 403 et sont masqués (mention « Lecture seule »). Accès complet pour
  `SHARE_OWNER_EMAIL` (`.env`) par le tunnel, et pour l'accès local
  (`GET /api/veille/access`, cf. `router/veille_access.py`).
- **L'avatar en parle** (ADR 0014, cf. `router/veille_journal.py`) : une question sur
  l'actualité, la veille, les idées, la météo ou un nom cité dans un titre (« tu as vu le
  truc sur Nvidia ? ») ajoute à la consigne un résumé du dernier passage réussi (15
  articles, cités d'abord) ; l'avatar raconte, donne son avis et demande le tien, sans
  lire. La recherche web n'est alors faite que si tu la demandes (« cherche sur
  internet »).
- **Journal** : mini-fenêtre de l'avatar en haut à gauche de la Veille, bouton
  « Lancer le journal » (ou « fais-moi le journal » en appel). L'avatar ouvre sur la
  météo puis présente 5 sujets (aimés d'abord, une catégorie différente tant que
  possible, jamais un article rejeté), donne son avis et attend le tien, rebondit, puis
  enchaîne ; il finit par deux idées et une conclusion. « Raconte-m'en plus » ou une
  question restent sur le sujet, « passe » ou « suivant » enchaînent sans réagir,
  « stop » conclut. Le routeur tient le conducteur (`GET|PUT|DELETE
/api/veille/journal`, phase en mémoire, 2 h au plus) et ne donne au modèle que l'étape
  et le sujet du moment, dans une note de régie collée au dernier message (un petit
  modèle se perd sinon). Le sujet présenté est marqué « À l'antenne » dans la liste.
  Disponible pendant un partage (lecture seule).
- **Ancienne interface** (`ui.sh legacy`) : pas de veille (nouvelle interface seulement).
- `FEATURES.md` doit exister avant le premier `docker compose up` (sinon Docker crée un
  dossier à sa place) ; le tenir à jour à chaque fin de feature, sous 4 000 caractères :
  une idée qui y figure déjà n'est plus proposée.
- Données : base `tasks.db` dans le volume `antares-tasks-data` (passages, météo, adresses
  déjà vues, idées), lue en lecture seule par le routeur (`GET /api/veille/latest`,
  `GET /api/veille?date=AAAA-MM-JJ`) ; le volume du routeur (Réglages, Connexions, votes,
  drapeau de partage) n'est monté qu'en lecture seule dans `antares-tasks`. Passages
  gardés 30 jours ; adresses vues, votes et prompts gardés sans limite. Redirections des
  flux : 3 au plus, vers une adresse https publique seulement.
- **Volume `antares-tasks-data` externe** : il a été créé hors de Compose ; déclaré
  `external: true`, il ne provoque plus l'avertissement « already exists but was not
  created by Docker Compose » et n'est jamais effacé par `docker compose down -v`.
  `install.sh` le crée s'il manque ; sur un poste installé avant cette version :
  `docker volume create antares-tasks-data` (sans effet sur un volume existant).

Tests (dans l'image, sans réseau ni vrai modèle) :

```bash
docker run --rm --entrypoint python -v "$PWD/tasks:/app:ro" -v "$PWD/router:/router:ro" \
  -v "$PWD/../../web/tests/fixtures/api:/web-fixtures:ro" -e VEILLE_FIXTURE=/web-fixtures/veille_latest.json \
  -w /app -e PYTHONPATH=/app:/router antares/s2s:1.0.0 -m unittest discover -p 'test_tasks_*.py'
docker run --rm --entrypoint python -v "$PWD/router:/router:ro" -w /router \
  antares/s2s:1.0.0 -m unittest discover -p 'test_*.py'
```

## Vérifications

| Script                                           | Rôle                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| `./check-local.sh`                               | Prouve l'isolation : Internet bloqué, seul Ollama joignable             |
| `docker compose run --rm antares-tasks schedule` | Prochains passages de la veille, dernier succès, créneaux manqués       |
| `./rag-index.sh <projet> <dossier>`              | Indexe un dossier dans le RAG intégré                                   |
| `./smoke-test.sh`                                | Appel de bout en bout sans micro, mesure la latence (`out/reponse.wav`) |
| `./voice-samples.sh`                             | Banc d'écoute de toutes les voix (`out/voix/index.html`)                |
| `python3 llm_bench.py <modèles…>`                | Compare des LLM Ollama en conditions réelles (`out/llm/index.html`)     |

## Architecture

```text
Navigateur ──> web (nginx + interface web/, 127.0.0.1:8765) ──> s2s (réseau antares-local, internal)
                 │ page, /voices, /config.json      VAD Silero, STT Parakeet, TTS Qwen3
                 │                                  │
                 └── /api (réglages) ──────────> llm-router ──> ollama (ai-to-boost)
                                                  │ réécrit `model` selon les réglages
                                                  └──> rag + qdrant (ai-to-boost)
                                                       extraits des projets

antares-tasks (8 h, 13 h, 18 h) ──> flux RSS, Open-Meteo (Internet, antares-search)
       │  ▲                    └──> modèle des Réglages (Connexions, ai-assistant-net)
       │  └── veille.db (votes, lecture seule) <── llm-router /api/veille/vote
       └── tasks.db (volume tasks-data) ──> llm-router /api/veille ──> fenêtre Veille
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
