# 0008 — Recherche web par SearXNG local et mode hors ligne signalé

- **Status** : accepted
- **Date** : 2026-09-30
- **Auteur(s)** : jprotin
- **Tags** : LLM, réseau, confidentialité

## Contexte

Les LLM locaux ont des connaissances figées (~2024) : versions, prix, actualité ou météo
sont faux ou inconnus. Le 29/09, la recherche web avait été écartée ; le 30/09,
l'utilisateur la demande, avec un **indicateur de connexion** et un comportement
explicite hors ligne : modèles locaux seulement, l'IA prévient que la recherche est
impossible puis répond simplement.

Contraintes : garder le moteur vocal isolé (ADR 0001), ne pas ajouter de latence aux
questions ordinaires (~1 s au premier mot), ne pas dépendre d'un compte ou d'une clé.

## Options envisagées

### Option 1 : SearXNG local, déclenchement par règles (actuel + demande explicite)

- **Pour** : sans clé ni compte ; métamoteur (plusieurs moteurs) ; aucune latence pour
  les autres questions ; décision prévisible.
- **Contre** : règles lexicales (faux positifs et négatifs possibles) ; un moteur peut
  bloquer ponctuellement l'instance.

### Option 2 : API de recherche (Brave Search)

- **Pour** : résultats stables, quotas clairs.
- **Contre** : compte et clé ; quota gratuit limité ; dépendance à un fournisseur.

### Option 3 : le LLM décide (appel d'outil ou classification) à chaque question

- **Pour** : décision plus fine.
- **Contre** : +0,5 s à chaque question, même sans recherche ; fiabilité moyenne du
  modèle local pour l'appel d'outils.

## Décision

Nous retenons l'**option 1**.

- Conteneur `searxng` (image figée), réseau `antares-search` partagé avec le routeur
  seul ; le moteur vocal reste sur `antares-local` (internal).
- `router/web.py` : sonde de connexion (30 s), règles de déclenchement, recherche,
  lecture des 3 premières pages (adresses publiques uniquement, y compris après
  redirection ; 600 Ko et 3 s au plus), extraits donnés au LLM comme **données** avec
  la **date du jour** (seulement lors d'une recherche) et la consigne de citer `[n]`.
- Hors ligne : Claude indisponible (refusé, remplacé par le modèle local s'il était
  choisi) ; pour une question qui aurait demandé une recherche, le routeur **impose** la
  première phrase (« Je n'ai plus accès à internet… ») avant la réponse du LLM.
- Présentation : renvois cliquables, bloc Sources et mots-clés dans l'interface ; les
  mots-clés sont demandés au modèle local après la réponse (le modèle 8B ne suit pas
  de façon fiable un format de fin de réponse imposé).

## Conséquences

### Positives

- Réponses à jour et sourcées, sans compte ni clé.
- L'état de la connexion est visible et le comportement hors ligne est déterministe.

### Négatives / Coûts

- Le texte des questions « actuelles » sort vers des moteurs publics.
- +1 à 3 s avant le premier mot quand une recherche est faite.
- Un conteneur de plus et un secret (`SEARXNG_SECRET`, généré par `install.sh`).

### Neutres / À surveiller

- Faux déclenchements des règles (« le dernier point dont on parlait ») : à ajuster.
- Pages hostiles : contenu borné et présenté comme donnée, mais un modèle 8B reste
  sensible aux injections ; aucune action n'est possible depuis une réponse.

## Alternatives non explorées (et pourquoi)

- **Navigateur headless pour lire les pages** : lourd ; l'extraction HTML simple suffit
  pour des extraits.

## Références

- ADR 0001 (isolation du moteur vocal), ADR 0002 (RAG), décision du 29/09 révisée
- `deploy/s2s/router/web.py`, `deploy/s2s/searxng/settings.yml`
