# Analyse — outil speech-to-speech 100 % local

- **Projet** : antares_ai
- **Date** : 2026-09-21
- **Statut** : brouillon — décisions en attente (cf. [§ 14](#14-décisions-à-prendre))
- **Périmètre** : assistant vocal entièrement local, utilisé depuis une **interface web
  d'appel** (comme un appel téléphonique), s'appuyant sur les LLM Ollama, la gateway
  LiteLLM et Claude Code (forfait), déjà en place dans la stack `ai-to-boost`

---

## 1. Synthèse

- **Expérience visée** : une page web locale où l'on « appelle » son LLM. Un orbe animé
  montre quand il **écoute**, **réfléchit** et **parle** ; des **sous-titres** affichent
  la conversation en direct ; chaque appel est **enregistré et archivé en local** pour être
  relu plus tard.
- **Architecture retenue (proposition)** : chaîne en cascade **VAD → STT → LLM → TTS**, en
  streaming phrase par phrase, orchestrée par **Pipecat** (Python) et transportée en
  **WebRTC** entre le navigateur et le backend.
- **Positionnement** : antares_ai est un **client** de la stack `ai-to-boost` existante
  (speaches, LiteLLM/Ollama, claude-bridge). Il ne relance **aucun service GPU** en double.
- **Manques à combler** : l'interface web, la synthèse vocale (TTS), la détection de parole
  (VAD), la coupure de parole (barge-in), l'enregistrement et l'archive.
- **Claude Code** : ne peut pas être le cerveau de la boucle vocale (latence de `claude -p`).
  Il intervient comme **outil asynchrone** (`ask_claude`) pour les demandes complexes.
- **Accès distant (optionnel)** : via un **tunnel ngrok** (HTTPS, authentification en
  bordure). ngrok ne transportant pas l'UDP de WebRTC, l'audio passe en **WebSocket** en
  mode distant. Le traitement et le stockage restent 100 % locaux.
- **Contrainte dimensionnante** : **12 Go de VRAM** partagés — un seul LLM vocal chargé à la fois.
- **Latence visée** : environ **0,6 à 1,4 s** entre la fin de la phrase de l'utilisateur et le
  premier son de la réponse.

## 2. Architecture cible

![Architecture cible speech-to-speech local](assets/architecture-s2s-local.svg)

**Flux nominal d'un appel** :

1. L'utilisateur **décroche** dans l'interface web. Le navigateur ouvre une session WebRTC
   avec le backend antares_ai (micro avec annulation d'écho, haut-parleur).
2. Le **VAD** (Silero, CPU) détecte le début puis la fin de la phrase. L'interface passe en
   état **écoute**, puis **réflexion**.
3. Le **client STT** appelle speaches (`/v1/audio/transcriptions`). Le texte obtenu est
   envoyé à l'interface comme **sous-titre utilisateur**.
4. L'**agent LLM** appelle LiteLLM (alias `local-voice`, en streaming), qui route vers Ollama.
5. Le **découpage** envoie chaque phrase complète au **client TTS** dès qu'elle est prête.
6. Le **client TTS** appelle `/v1/audio/speech`. La **sortie WebRTC** joue l'audio et
   envoie à l'interface la phrase prononcée (**sous-titre assistant**) et l'état **parole**.
7. Si l'utilisateur reprend la parole, la **coupure de parole** interrompt la génération
   et la lecture ; l'interface passe en état **interrompu** puis **écoute**.
8. Pour une demande complexe, l'agent appelle l'**outil `ask_claude`** (claude-bridge puis
   `claude -p`, en asynchrone).
9. Tout au long de l'appel, l'**archivage local** enregistre le transcript horodaté et
   l'audio. Au raccrochage, la session est finalisée et apparaît dans l'**historique**.

**Mode distant** : depuis Internet, le navigateur passe par le **tunnel ngrok** et l'audio
est transporté en **WebSocket** au lieu de WebRTC. Le reste du flux est identique (cf. § 8).

## 3. Existant réutilisable

Inventaire réalisé le 2026-09-21 sur le poste de développement.

| Brique                                  | Service existant (`ai-to-boost`)                             | État pour le speech-to-speech                                   |
| --------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| STT                                     | `speaches` `:8000` — faster-whisper-medium, CUDA, fp16       | OK, API compatible OpenAI                                       |
| LLM local                               | Ollama `:11434` (gemma4:e4b, qwen3.5:9b) via LiteLLM `:4000` | OK, streaming possible                                          |
| Claude                                  | `claude-bridge` `:8088` sur l'hôte (`claude -p`, forfait)    | OK, mais **bloquant** : réponse JSON complète, pas de streaming |
| Interface web                           | `webui` `:3001` (Next.js)                                    | Existe, mais sans voix temps réel                               |
| TTS                                     | —                                                            | **manquant**                                                    |
| VAD, coupure de parole, transport audio | —                                                            | **manquant**                                                    |
| Enregistrement et archive des appels    | —                                                            | **manquant**                                                    |

- **Matériel** : NVIDIA RTX 5070 Ti Laptop (**12 Go VRAM**), 62 Go de RAM.
- **Contrainte héritée (ADR 0002 d'ai-to-boost)** : Claude uniquement via `claude -p` avec le
  forfait, jamais d'`ANTHROPIC_API_KEY`.
- **Cohérence avec l'existant (ADR 0006 d'ai-to-boost)** : un « futur frontend voix » doit
  réutiliser le contrat de gateway. antares_ai correspond exactement à ce frontend.

## 4. Options d'architecture

### A. Chaîne en cascade VAD → STT → LLM → TTS — recommandée

- La réponse du LLM est découpée phrase par phrase et chaque phrase est synthétisée dès
  qu'elle est complète : l'assistant commence à parler avant la fin de la génération.
- Chaque brique réutilise l'existant et reste **remplaçable** indépendamment.
- Le texte existe à chaque étape : les **sous-titres** et l'**archive** sont gratuits.
- Toutes les briques exposent des API compatibles OpenAI : **portable vers le cloud** sans
  réécriture.

### B. Modèle speech-to-speech natif (Moshi, Qwen-Omni, Ultravox…) — écartée pour l'instant

- Latence théorique plus faible.
- Mais : français faible ou non garanti, modèles corrects au-delà de 12 Go de VRAM,
  **impossible d'y brancher les LLM Ollama ou Claude** (bloc fermé), et sous-titres non
  garantis (pas toujours de texte intermédiaire).
- À réévaluer plus tard derrière la même interface.

### C. Produit existant (voice mode d'Open WebUI, etc.) — banc de comparaison uniquement

- Rapide à tester, mais sans contrôle sur l'expérience d'appel, les états visuels ou
  l'archive, hors du contrat de gateway et sans routage vers Claude Code.

## 5. Choix des briques (option A)

| Brique                   | Recommandation                                                | Alternatives                         | Remarques                                                                                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Orchestration temps réel | **Pipecat** (Python)                                          | LiveKit Agents                       | Pipecat gère VAD, découpage, coupure de parole, services compatibles OpenAI, et fournit un transport WebRTC pair-à-pair sans serveur tiers. LiveKit ajoute un serveur média.                                                                           |
| Transport audio          | **WebRTC navigateur** (local), **WebSocket** (distant)        | PipeWire (CLI)                       | WebRTC apporte l'annulation d'écho et la réduction de bruit du navigateur, indispensables à la coupure de parole sans casque. PipeWire reste utile pour le MVP en ligne de commande. En distant, ngrok ne transporte pas l\'UDP : WebSocket (cf. § 8). |
| VAD                      | **Silero VAD**, sur CPU                                       | —                                    | Coût en ressources négligeable.                                                                                                                                                                                                                        |
| STT                      | speaches existant, passage à **large-v3-turbo**               | medium actuel                        | Meilleur en français et plus rapide que medium. VRAM à mesurer.                                                                                                                                                                                        |
| LLM                      | **`local-gemma`** via LiteLLM                                 | `local-qwen`                         | Créer un **alias dédié `local-voice`** : contexte court (~8k), raisonnement désactivé, consigne de réponses brèves.                                                                                                                                    |
| TTS                      | **Kokoro** (82M, GPU ou CPU) ou **Piper** (CPU, voix `fr_FR`) | Chatterbox multilingue, XTTS-v2      | Le français est le point faible de Kokoro : écouter avant de trancher.                                                                                                                                                                                 |
| Service TTS              | `/v1/audio/speech` de speaches                                | conteneur dédié                      | **À vérifier** : support TTS dans l'image speaches utilisée.                                                                                                                                                                                           |
| Interface web            | **React + TypeScript**                                        | Next.js (comme la webui ai-to-boost) | Cf. § 7.6.                                                                                                                                                                                                                                             |
| Archive                  | **SQLite** (+ FTS5) et fichiers audio **Opus**                | PostgreSQL existant                  | Cf. § 7.4.                                                                                                                                                                                                                                             |

**Point d'attention LLM** : `OLLAMA_CONTEXT_LENGTH=32768` gonfle le cache KV et le temps avant
le premier token. L'alias vocal doit fixer un contexte court par requête (connecteur
`ollama_chat/` avec `num_ctx`, comme les alias « long » existants).

**Licences TTS** : XTTS-v2 (CPML) et les poids de F5-TTS sont **non commerciaux**.

## 6. Intégration de Claude Code

`claude -p` ne convient **pas** comme cerveau de la conversation : lancement du processus
plus génération = plusieurs secondes, et le bridge actuel renvoie la réponse d'un bloc.

| Rôle                             | Description                                                                                                                                                                                              | Statut                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1. Escalade par outil            | Le LLM local mène la conversation ; pour une demande complexe, il appelle `ask_claude`. L'assistant annonce « je transmets à Claude » puis lit la réponse à son arrivée (asynchrone, conforme ADR 0006). | **Recommandé**                                 |
| 2. Bridge en streaming           | Ajouter un mode `--output-format stream-json` au bridge pour lire la réponse de Claude phrase par phrase.                                                                                                | Évolution d'ai-to-boost, hors de ce repo       |
| 3. Piloter Claude Code à la voix | Dictée vers une session Claude Code ; un hook `Stop` lit la réponse en synthèse vocale. Pas de temps réel.                                                                                               | Cas d'usage distinct, livrable rapide possible |

Les trois rôles respectent la règle CGU : Claude uniquement via `claude -p` ou le CLI.

Dans l'interface, une escalade vers Claude doit être **visible** : badge « Claude travaille »
sur l'orbe, et sous-titre de la réponse marqué comme provenant de Claude.

## 7. Interface web d'appel

### 7.1 Expérience utilisateur

L'interface reprend les codes d'un **appel téléphonique** plutôt que ceux d'un chat :

- **Écran d'accueil** : choix du modèle (`local-gemma`, `local-qwen`), bouton **Appeler**.
- **Écran d'appel** : l'orbe animé au centre, les sous-titres en dessous, une barre de
  commandes (**raccrocher**, **muet**, bascule **mains libres / push-to-talk**), la durée
  de l'appel et un **voyant d'enregistrement** toujours visible.
- **Historique** : liste des appels passés, recherche, relecture.

### 7.2 États visuels (écoute, réflexion, parole)

L'orbe est piloté par une **machine d'états** alimentée par les événements du backend, et
son animation par le **niveau audio réel** (API Web Audio du navigateur, `AnalyserNode`).

| État                | Déclencheur                                       | Rendu visuel proposé                                       |
| ------------------- | ------------------------------------------------- | ---------------------------------------------------------- |
| Au repos            | Appel connecté, personne ne parle                 | Orbe calme, respiration lente                              |
| **Écoute**          | Le VAD détecte la voix de l'utilisateur           | Anneau qui pulse avec le volume du **micro**               |
| **Réflexion**       | Fin de phrase, attente du STT et du premier token | Rotation ou scintillement doux                             |
| **Parole**          | Le TTS commence à jouer                           | Orbe déformé par l'amplitude de la **voix de l'assistant** |
| Interrompu          | L'utilisateur coupe la parole                     | Contraction brève, puis retour en écoute                   |
| Claude              | Escalade `ask_claude` en cours                    | Badge ou couleur dédiée, sans bloquer la conversation      |
| Erreur / hors ligne | Service indisponible, modèle évincé de la VRAM    | Orbe grisé et message explicite                            |

- **Rendu** : Canvas 2D suffit pour une première version ; WebGL (three.js) si l'on veut
  un rendu plus riche. Pas besoin de GPU côté navigateur pour du Canvas 2D.
- **Principe** : l'état vient du **backend** (source de vérité : VAD, début et fin du TTS),
  l'amplitude vient du **navigateur** (flux audio réels). Cela évite un orbe qui « parle »
  alors que l'audio n'est pas encore arrivé.

### 7.3 Sous-titres en direct

| Flux        | Source                | Moment d'affichage                                                                                       |
| ----------- | --------------------- | -------------------------------------------------------------------------------------------------------- |
| Utilisateur | Transcription STT     | À la fin de chaque phrase (faster-whisper n'est pas un STT en streaming : pas de mots partiels en v1)    |
| Assistant   | Phrase envoyée au TTS | **Au moment où la phrase est jouée**, pas quand le LLM l'a générée, pour rester synchronisé avec la voix |

- **v1** : synchronisation à la **phrase**. Une synchronisation au **mot** (karaoké)
  suppose un TTS qui fournit des horodatages par mot : à évaluer en phase 0.
- En cas de coupure de parole, la phrase interrompue est **tronquée et marquée**
  (« … [interrompu] ») pour que le transcript reflète ce qui a vraiment été entendu.
- Chaque sous-titre porte un **horodatage relatif au début de l'appel**, réutilisé pour la
  relecture synchronisée (§ 7.5).
- Option : taille de police réglable et thème à fort contraste (accessibilité).

### 7.4 Enregistrement et archivage local

**Ce qui est enregistré pour chaque appel** :

| Élément     | Format                                                                                        | Usage                                                      |
| ----------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Métadonnées | Ligne SQLite : identifiant, date, durée, modèle, nombre d'escalades Claude, latences mesurées | Liste et filtres de l'historique, suivi de la latence      |
| Transcript  | Lignes SQLite horodatées (locuteur, texte, début, fin, interrompu ou non) + index **FTS5**    | Sous-titres, recherche plein texte                         |
| Audio       | Fichier **Opus** (`.ogg`), idéalement **deux pistes** : utilisateur et assistant              | Relecture ; pistes séparées pour réécouter l'un ou l'autre |

**Où** : côté **backend** (pas dans le navigateur), sur le disque local, dans un dossier
de données dédié hors du dépôt git, par exemple :

```text
data/
├── antares.db                      # SQLite : appels, transcripts, index FTS5
└── sessions/
    └── 2026/09/21/<id-appel>/
        ├── user.ogg
        └── assistant.ogg
```

- Pipecat fournit un processeur de tampon audio pour capter les flux entrant et sortant : à
  valider en phase 0 pour l'enregistrement en pistes séparées.
- L'écriture du transcript se fait **au fil de l'eau** (pas seulement au raccrochage), pour
  ne rien perdre en cas de plantage.
- **Volume** : la voix en Opus à ~24 kbit/s représente environ **10 Mo par heure et par
  piste**. Le stockage n'est pas un problème à l'échelle d'un usage personnel.

### 7.5 Historique et relecture

- **Liste** des appels : date, durée, modèle, premières phrases, recherche plein texte.
- **Relecture** : lecteur audio avec les sous-titres qui défilent en synchro ; clic sur
  une phrase pour y sauter.
- **Actions** : renommer ou annoter un appel, exporter (Markdown ou JSON), supprimer.
- **Évolution possible** : indexer les transcripts dans Qdrant (déjà présent) pour
  interroger ses anciennes conversations (« de quoi a-t-on parlé mardi ? »).

### 7.6 Choix techniques de l'interface

| Option                                                                                                       | Avantages                                                                        | Inconvénients                                                                          |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Application dédiée dans antares_ai** (React + TypeScript), servie par le backend FastAPI — **recommandée** | Autonome, cycle de vie propre, portable vers le cloud avec le reste d'antares_ai | Une interface de plus à côté de la webui ai-to-boost                                   |
| Onglet « Appel » dans la webui ai-to-boost (Next.js)                                                         | Un seul point d'entrée                                                           | Couple les deux projets ; la webui passe par un BFF qui n'est pas prévu pour du WebRTC |

- Pipecat fournit des SDK clients JavaScript et React qui gèrent la connexion WebRTC et
  exposent les événements (début et fin de parole de l'utilisateur et du bot, transcripts).
  Ils couvrent l'essentiel des besoins des § 7.2 et 7.3 : à confirmer en phase 0.
- Si l'on choisit React, le composant d'appel pourra plus tard être réintégré dans la
  webui ai-to-boost sans réécriture.

### 7.7 Confidentialité et sécurité

- **Écoute locale uniquement** : interface et backend liés à `127.0.0.1`, comme le reste de
  la stack. `localhost` est un contexte sécurisé : le navigateur autorise le micro sans HTTPS.
- **Accès depuis un autre appareil ou depuis Internet** : via le tunnel ngrok, qui fournit
  le HTTPS nécessaire au micro. Mesures de sécurité dédiées au § 8.4.
- **Voix = donnée personnelle** : voyant d'enregistrement permanent, possibilité de
  désactiver l'enregistrement audio en gardant le transcript, **durée de rétention**
  configurable avec purge automatique.
- **Stockage** : dossier `data/` exclu de git ; chiffrement du disque recommandé si le poste
  est nomade.

## 8. Accès distant via ngrok

### 8.1 Objectif

Utiliser l'interface d'appel **depuis Internet** (téléphone en 4G/5G, autre ordinateur)
alors que toute la chaîne (modèles, archive) reste sur le poste local.

- ngrok ouvre un **tunnel sortant** depuis le poste : aucun port à ouvrir sur la box,
  aucune IP publique nécessaire.
- ngrok publie un domaine en **HTTPS** : le navigateur distant est en contexte sécurisé et
  autorise donc le micro.
- Le principe « 100 % local » s'applique au **traitement** et au **stockage**. En mode
  distant, le **transport** passe par l'infrastructure ngrok.

### 8.2 Principe

- Un **agent ngrok** local (conteneur ou service systemd) publie **uniquement le backend
  antares_ai** (interface web + API), sur un domaine statique.
- Rien d'autre n'est exposé : LiteLLM (`:4000`), Ollama (`:11434`), speaches (`:8000`),
  claude-bridge (`:8088`), n8n (`:5678`) et la webui ai-to-boost (`:3001`) restent sur
  `127.0.0.1` ou le réseau docker.
- Le tunnel est **désactivé par défaut** et s'active explicitement (profil ou commande
  dédiée), avec un moyen simple de le couper.

### 8.3 Contrainte majeure : WebRTC et UDP

ngrok tunnelise du HTTP(S) et du TCP, **pas de l'UDP**. Or WebRTC transporte l'audio en UDP.
En local, cela fonctionne car navigateur et backend sont sur la même machine ; depuis
Internet, le navigateur distant ne peut pas joindre directement le backend derrière le NAT.

| Option                                         | Principe                                                                                | Avantages                                              | Inconvénients                                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **A. WebSocket en mode distant** — recommandée | Pipecat propose aussi un transport WebSocket : l'audio passe dans le tunnel HTTPS ngrok | Simple, un seul tunnel, rien d'autre à héberger        | TCP : un peu plus de latence et de sensibilité aux pertes sur réseau mobile ; encodage audio à optimiser                                 |
| B. WebRTC + serveur TURN                       | Relais TURN (coturn local exposé en TCP via ngrok, ou service TURN hébergé)             | Conserve WebRTC (gestion de la gigue, qualité)         | Configuration ICE complexe ; tunnel TCP ngrok soumis à conditions d'offre (à vérifier) ; un TURN hébergé est un tiers qui relaie l'audio |
| C. VPN maillé (Tailscale) à la place de ngrok  | Réseau privé WireGuard (UDP) entre l'appareil et le poste                               | WebRTC fonctionne tel quel, rien d'exposé publiquement | Client VPN à installer sur chaque appareil ; pas d'accès « depuis n'importe quel navigateur »                                            |

- **Recommandation : option A.** Le backend expose les deux transports : WebRTC en local,
  WebSocket en distant. Le frontend choisit selon l'origine de la page (`127.0.0.1` ou
  domaine ngrok).
- L'**annulation d'écho** reste active en distant : c'est une option de capture du micro
  dans le navigateur, indépendante du transport.
- Pour un usage **strictement personnel** depuis ses propres appareils, l'option C est plus
  sûre (aucune exposition publique). Elle peut coexister avec ngrok.

### 8.4 Sécurité de l'exposition Internet

Le service exposé peut déclencher les LLM, lire l'archive des conversations et appeler
Claude Code. Il faut donc plusieurs barrières :

| Mesure                            | Détail                                                                                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentification en bordure ngrok | Politique de trafic ngrok : OAuth (Google ou GitHub) restreint à tes adresses, ou OIDC. Les requêtes non authentifiées n'atteignent jamais le poste. Disponibilité selon l'offre : à vérifier. |
| Authentification applicative      | Session ou jeton côté backend en plus de ngrok (défense en profondeur).                                                                                                                        |
| Surface minimale                  | Un seul port publié (backend antares_ai). Jamais les ports de la stack ai-to-boost.                                                                                                            |
| `ask_claude` en distant           | Désactivable ou soumis à confirmation, pour qu'un accès compromis ne puisse pas lancer `claude -p` sur le forfait.                                                                             |
| Archive en distant                | Consultation autorisée, suppression et export désactivables à distance.                                                                                                                        |
| Restriction d'IP                  | Optionnelle, via la politique de trafic ngrok.                                                                                                                                                 |
| Secrets                           | Authtoken ngrok dans `.env`, jamais versionné (gitleaks et detect-secrets en pre-commit).                                                                                                      |
| Traçabilité                       | Journalisation des accès (ngrok + backend), affichage « accès distant actif » dans l'interface locale.                                                                                         |
| Confidentialité du transport      | ngrok termine le TLS à sa bordure : le trafic y est visible en clair. Un chiffrement de bout en bout (terminaison TLS locale) est possible selon l'offre : à vérifier si l'exigence est forte. |

### 8.5 Mise en œuvre

- **Agent ngrok** : service `ngrok` dans un `compose.yaml` d'antares_ai, sous un **profil
  `remote`** non démarré par défaut, pointant vers le backend sur le réseau docker. Un
  service systemd est une alternative.
- **Configuration versionnée** : fichier de politique de trafic (authentification, IP)
  dans `deploy/ngrok/`, sans secret.
- **Domaine statique** : l'offre gratuite en fournit un, ce qui évite de changer d'URL à
  chaque démarrage.
- **Offre** : l'offre gratuite a des limites (bande passante, connexions, page
  d'avertissement ngrok à la première visite). Une offre payante se justifie en usage
  régulier. Chiffres à vérifier sur ngrok.com au moment du choix.
- **Bande passante audio** : en Opus (~24 kbit/s par sens), un appel consomme environ
  **20 Mo par heure** aller-retour ; en PCM 16 kHz brut (256 kbit/s par sens), environ
  **230 Mo par heure**. L'encodage Opus sur le WebSocket est donc à privilégier (support à
  vérifier en phase 0).

### 8.6 Latence en mode distant

| Étape supplémentaire                                  | Estimation       |
| ----------------------------------------------------- | ---------------- |
| Aller-retour vers le point de présence ngrok (Europe) | ~20 à 60 ms      |
| Réseau mobile (4G/5G)                                 | ~30 à 100 ms     |
| Gigue TCP sur réseau dégradé                          | variable         |
| **Total perçu estimé**                                | **~0,8 à 1,8 s** |

## 9. Budget VRAM (12 Go)

Ordres de grandeur, **à mesurer** en phase 0. L'interface et l'archive ne consomment pas de VRAM.

| Composant               | Estimation                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------- |
| Whisper large-v3-turbo  | ~1,5 à 3 Go (int8 ou fp16)                                                              |
| gemma4:e4b, contexte 8k | ~3 à 5 Go (le commentaire LiteLLM indique ~3,3 Go, Ollama annonce un fichier de 9,6 Go) |
| Kokoro                  | < 1 Go (0 avec Piper sur CPU)                                                           |
| **Total**               | **~6 à 9 Go** — tient avec **un seul LLM chargé**                                       |

- Avec qwen3.5:9b à la place de gemma, le budget devient serré.
- `OLLAMA_KEEP_ALIVE=30m` garde le modèle chaud : favorable à la latence.
- **Risque** : un autre usage de la stack (pipeline BMAD, RAG, contexte long) charge un
  modèle et **évince** le LLM vocal.

## 10. Budget de latence

| Étape                                 | Cible            |
| ------------------------------------- | ---------------- |
| Détection de fin de parole (VAD)      | 200 à 400 ms     |
| STT d'une phrase courte               | 150 à 300 ms     |
| Premier token du LLM (modèle en VRAM) | 150 à 400 ms     |
| Synthèse de la première phrase        | 100 à 300 ms     |
| Transport WebRTC local                | < 50 ms          |
| Mode distant (ngrok, cf. § 8.6)       | +0,2 à 0,4 s     |
| **Total perçu**                       | **~0,6 à 1,4 s** |

L'état **réflexion** de l'orbe (§ 7.2) rend ce délai lisible : l'utilisateur voit qu'il a
été entendu.

## 11. Risques

| Risque                                     | Impact                                                               | Mitigation                                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Qualité du TTS français                    | Expérience dégradée                                                  | Écoute comparative Kokoro / Piper / Chatterbox en phase 0                                                              |
| Écho et coupure de parole                  | L'assistant s'interrompt lui-même                                    | Annulation d'écho WebRTC du navigateur ; casque en secours                                                             |
| Concurrence VRAM avec le reste de la stack | Rechargement du modèle, latence de plusieurs secondes                | Alias vocal dédié, un seul LLM chargé, surveillance `ollama ps`, état « erreur » explicite dans l'interface            |
| Latence de Claude                          | Silence prolongé                                                     | Claude uniquement en escalade asynchrone, annonce vocale, badge dans l'interface                                       |
| Modèle « raisonnant » (qwen3.5)            | Latence élevée, contenu vide                                         | Raisonnement désactivé (problème déjà rencontré dans ai-to-boost)                                                      |
| Désynchronisation sous-titres / voix       | Sous-titres en avance sur la voix                                    | Afficher la phrase au début de sa lecture, pas à sa génération                                                         |
| Perte d'enregistrement (plantage)          | Appel non archivé                                                    | Écriture du transcript au fil de l'eau, finalisation audio robuste                                                     |
| Données vocales sensibles                  | Exposition de données personnelles                                   | Local uniquement, rétention configurable, voyant d'enregistrement, `data/` hors git                                    |
| Licences TTS                               | Blocage d'un usage commercial                                        | Écarter XTTS-v2 et F5-TTS si usage commercial                                                                          |
| Support TTS de speaches                    | Service manquant                                                     | Vérification en phase 0, repli sur un conteneur dédié                                                                  |
| Exposition Internet (ngrok)                | Accès non autorisé aux LLM, à l'archive, à Claude                    | Authentification en bordure ngrok + applicative, surface minimale, `ask_claude` restreint, tunnel désactivé par défaut |
| WebRTC impossible via ngrok (UDP)          | Pas d'audio en distant                                               | Transport WebSocket en mode distant (ou TURN, ou Tailscale)                                                            |
| Dépendance à ngrok                         | Transport visible à la bordure ngrok, limites d'offre, disponibilité | Données non stockées chez ngrok ; Tailscale en alternative ; offre adaptée à l'usage                                   |

## 12. Feuille de route

| Phase                    | Contenu                                                                                                                                                                                                | Livrable                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 0. Benchmark (~1 à 2 j)  | Latence STT (medium vs large-v3-turbo), temps avant premier token des deux LLM, écoute de 3 TTS en français, vérification du TTS speaches, prise en main du transport WebRTC et des événements Pipecat | ADR « choix des modèles » et ADR « transport et interface » |
| 1. MVP CLI push-to-talk  | Micro → STT → LLM en streaming → TTS phrase par phrase → haut-parleur, sans VAD ni coupure                                                                                                             | Script CLI fonctionnel                                      |
| 2. Interface d'appel     | Backend Pipecat + FastAPI, WebRTC navigateur, VAD, coupure de parole, orbe animé à états, sous-titres synchronisés à la phrase                                                                         | Appel vocal dans le navigateur                              |
| 3. Archive et historique | Enregistrement du transcript et de l'audio, SQLite + FTS5, page historique avec relecture synchronisée, export, rétention                                                                              | Appels archivés et relisibles                               |
| 4. Claude                | Outil `ask_claude` via le bridge, annonce vocale, badge dans l'interface ; optionnel : streaming dans le bridge                                                                                        | Escalade vers Claude                                        |
| 5. Finitions             | Sous-titres au mot si le TTS le permet, thème accessible, recherche sémantique via Qdrant                                                                                                              | Confort et recherche avancée                                |
| 6. Accès distant         | Agent ngrok (profil `remote`), transport WebSocket, authentification en bordure et applicative, restrictions en distant                                                                                | Interface d'appel accessible depuis Internet                |
| 7. Cloud                 | Conteneurisation d'antares_ai, endpoints paramétrables, HTTPS et authentification                                                                                                                      | Déploiement cloud                                           |

## 13. Structure de dépôt envisagée

```text
antares_ai/
├── backend/          # Python : Pipecat, FastAPI (signalisation WebRTC, API historique)
├── frontend/         # React + TypeScript : écran d'appel, orbe, sous-titres, historique
├── data/             # SQLite + audio des appels (exclu de git)
├── deploy/ngrok/     # politique de trafic ngrok (sans secret)
└── docs/
    ├── adr/
    └── analyse-speech-to-speech-local.md
```

## 14. Décisions à prendre

1. **Cas d'usage principal** : assistant conversationnel vocal, ou pilotage de Claude Code à
   la voix (§ 6, rôle 3) ?
2. **Langue** : français seul, ou français et anglais ?
3. **Interaction** : mains libres par défaut, ou push-to-talk par défaut ?
4. **Positionnement** : client de la stack ai-to-boost (recommandé) ou projet autonome avec
   ses propres services ?
5. **Interface** : application dédiée dans antares_ai (recommandé) ou onglet dans la webui
   ai-to-boost ?
6. **Archive** : conserver l'audio en plus du transcript ? Quelle durée de rétention ?
7. **Usage commercial** envisagé ? Détermine les licences TTS acceptables.
8. **Accès distant** : ngrok (accès depuis n'importe quel navigateur) ou Tailscale (plus
   sûr, appareils personnels uniquement), voire les deux ?
9. **Offre ngrok** : gratuite ou payante ? Méthode d'authentification (OAuth Google ou
   GitHub) ?
10. **Fonctions autorisées à distance** : escalade Claude, consultation et suppression de
    l'archive ?
