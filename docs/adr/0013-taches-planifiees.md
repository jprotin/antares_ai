# 0013 — Tâches planifiées dans un service Docker d'Antares, lues dans l'interface web

- **Status** : accepted (2026-11-17, feature `taches-planifiees`)
- **Date** : 2026-11-16
- **Auteur(s)** : jprotin
- **Tags** : architecture, planification, réseau, dépendances

> **En bref** — Antares lance des tâches à heure fixe (veille IA, météo). Elles tournent
> dans un nouveau service `antares-tasks`, avec une petite boucle de planification en
> Python, sans nouvelle bibliothèque. Les résultats sont enregistrés en base et lus dans
> l'interface web ; rien ne part sur Telegram. Le modèle est **celui des Réglages**,
> appelé par les Connexions du routeur (décision 0009), pas par LiteLLM d'ai-to-boost.

## Contexte

Antares est une plateforme vocale locale. Ses services tournent dans `deploy/s2s/compose.yaml`
et l'image `antares/s2s:1.0.0` est figée (`constraints.txt`). La stack voisine ai-to-boost
fournit LiteLLM, n8n et un bot Telegram, joignables par le réseau `ai-assistant-net`.

La feature demande trois créneaux quotidiens à heure de Paris, une mémoire des articles
examinés, des tests unitaires et une commande manuelle par tâche. Il faut choisir où vit
l'ordonnancement, par où passe le modèle et où arrive le résultat. La décision 0009 impose
de passer par les fournisseurs configurables du routeur, pour rester portable sans ai-to-boost.

## Options envisagées

| Option                     | En une phrase                          | Principal avantage                           | Principal inconvénient                               |
| -------------------------- | -------------------------------------- | -------------------------------------------- | ---------------------------------------------------- |
| 1. Service Python maison   | Boucle `zoneinfo` dans `antares-tasks` | Code testé et versionné ici, zéro dépendance | Planification à écrire et tester soi-même            |
| 2. Workflow n8n            | Nœud Cron + HTTP dans ai-to-boost      | Rien à coder pour l'ordonnancement           | Logique hors du dépôt, tests unitaires difficiles    |
| 3. Cron de l'hôte          | `crontab` lance `docker compose run`   | Planification éprouvée                       | Dépend de la machine, absent sur une VM cloud vierge |
| 4. APScheduler ou croniter | Bibliothèque de planification          | Moins de code                                | Nouvelle dépendance dans une image figée             |

<details markdown="1">
<summary>Détail des options</summary>

### Option 1 : service Python maison

- **Pour** : portable local et cloud (règle du projet) ; tests unittest dans l'image
  (pytest en est absent) ; même image que `llm-router`, donc rien à construire.
- **Contre** : gestion du fuseau, des doublons et des redémarrages à notre charge.
- **Coût** : quelques centaines de lignes (planification, collecte, contrôle des
  réponses), plus leurs tests.

### Option 2 : n8n

- **Pour** : interface visuelle, relance facile.
- **Contre** : le dédoublonnage et la mise en forme vivraient dans des nœuds JSON, hors des
  tests demandés ; couplage fort à ai-to-boost.

### Option 3 : cron de l'hôte

- **Pour** : simple.
- **Contre** : configuration hors du dépôt, à refaire sur chaque machine.

### Option 4 : bibliothèque de planification

- **Contre** : l'image est figée par `constraints.txt` ; ajouter un paquet impose une
  reconstruction en ligne.

</details>

## Décision

Nous retenons l'option 1.

- Le service `antares-tasks` réutilise l'image `antares/s2s:1.0.0`, lit `tasks/tasks.yaml`
  (validé par pydantic, déjà dans l'image) et enregistre chaque passage en SQLite (mode
  WAL) dans son propre volume `tasks-data` ; le volume `router-data` (Réglages,
  Connexions, drapeau de partage) n'y est monté qu'en lecture seule. Un créneau est pris en base avant le passage : un
  seul passage par créneau, même avec deux processus ; un créneau manqué n'est jamais
  rattrapé.
- **Modèle** : vide par défaut dans `tasks.yaml`, c'est le modèle actif des Réglages (celui
  de la voix), ou son repli s'il s'agit de Claude. Le nom est passé tel quel à
  `router/providers.py`, sans forcer `num_ctx` : Ollama ne recharge pas le modèle.
- Le service lit `connections.json` mais ne l'écrit **jamais** (écriture neutralisée au
  démarrage) : fichier absent ou incomplet, passage en échec avec un message clair.
- Le modèle répond en JSON contrôlé par pydantic (schéma
  `tasks/schemas/veille-reponse.schema.json`, tiré du modèle et vérifié par un test) et
  cite les articles par identifiant : titres et liens viennent toujours de la collecte.
- Le routeur lit les passages de `tasks.db` en lecture seule (`GET /api/veille/latest`,
  avec la liste des jours, et `GET /api/veille?date=AAAA-MM-JJ`). Il écrit dans sa propre
  base `veille.db` (volume `router-data`, journal DELETE) : les votes « J'aime / Je n'aime
  pas » sur les articles et « Intéressé / Pas intéressé » sur les idées
  (`POST /api/veille/vote`, champs recopiés depuis `tasks.db`, jamais depuis la requête),
  et les prompts des idées « Intéressé », fabriqués une fois par le routeur via
  `providers.py` puis mis en cache (`GET|POST /api/veille/idea/<id>/prompt`). Le service
  `antares-tasks` relit ces votes (lecture seule) pour orienter les passages suivants
  (20 articles, 6 idées). Révisé le 2026-11-17 : pendant un partage public, la veille
  reste visible ; elle est en lecture seule pour les invités et complète pour le
  propriétaire (`SHARE_OWNER_EMAIL`, adresse Google transmise par ngrok dans
  `x-antares-user` après la connexion, en-tête de l'invité retiré d'abord) et l'accès
  local (cf. `router/veille_access.py`).
- L'interface web (`web/src/features/veille/`) les affiche dans une fenêtre plein écran
  avec une pastille de nouveauté. Le service rejoint `ai-assistant-net` et
  `antares-search`, jamais `antares-local` (`check-local.sh` le vérifie).

Sortie écartée : Telegram (secrets à recopier par `install.sh`, dépendance au bot
d'ai-to-boost). Passerelle écartée : LiteLLM d'ai-to-boost en direct (contraire à la
décision 0009 ; il reste utilisable s'il est déclaré comme fournisseur dans Connexions).

## Conséquences

### Positives

- Toute la logique est dans le dépôt, testée (unittest dans l'image, Vitest, Playwright
  simulé), revue en pre-commit.
- Aucune reconstruction d'image, aucun nouveau secret, aucune variable d'environnement.
- Même modèle que la voix : pas de rechargement ni de mémoire graphique en plus.

### Négatives / Coûts

- Un conteneur de plus, toujours démarré.
- Sortie Internet planifiée, documentée à côté de la preuve d'isolement du moteur vocal.
- Une base partagée entre deux conteneurs (volume `tasks-data` : écriture d'un côté,
  lecture de l'autre) ; les clés d'API de `connections.json` deviennent lisibles par ce
  conteneur (volume `router-data` en lecture seule, même image, code monté en lecture
  seule, aucun port publié), mais ni modifiables ni le drapeau de partage.
- Redirections des flux suivies à la main (3 au plus), seulement vers une adresse https
  publique : un flux piégé ne peut pas viser le réseau interne (qdrant, ollama…).
- Aucune alerte hors de l'interface : une veille manquée ne se voit qu'en ouvrant la fenêtre.
- Prompt d'idée destiné à Claude Code (un agent qui a le shell) : son contenu dérive de
  flux tiers et d'un petit modèle local, donc d'une injection possible. Risque accepté,
  atténué : chaque partie est bornée, les éléments qui portent une URL, une commande
  risquée ou une formule d'injection sont écartés, l'article d'origine n'apparaît que
  par son domaine marqué « donnée non vérifiée », et la fenêtre demande de relire avant
  de coller.

### Neutres / À surveiller

- Partage de la carte graphique avec un appel vocal : veille reportée de 15 minutes au
  plus ; un long silence pendant un appel n'est pas détecté.
- Si d'autres tâches s'ajoutent, réévaluer une bibliothèque de planification.

## Ce que ça change

- Le mainteneur lit la veille et la météo dans l'interface ; une pastille signale la nouveauté.
- Les horaires et les flux se changent dans `tasks.yaml`, puis redémarrage du service.
- `docker compose run --rm antares-tasks veille` lance une tâche à la main (toujours avec
  une sous-commande) ; `--dry-run` n'enregistre rien.

## Alternatives non explorées (et pourquoi)

- **Ordonnanceur intégré à `llm-router`** : mélangerait une boucle de fond et l'API temps
  réel de la voix.
- **Service cloud de planification** : contraire à l'exécution locale.

## Références

- Guide : `deploy/s2s/README.md`, section « Veille IA et météo »
- ADR 0008 (recherche web et mode hors ligne), ADR 0009 (fournisseurs de modèles
  configurables), ADR 0012 (interface Vite + React + shadcn/ui)
