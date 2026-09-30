# 0007 — Agents d'action : worker ai-to-boost en mode fichiers, lancement vocal confirmé

- **Status** : deprecated (fonctionnalité retirée le 2026-09-30 : pas de besoin réel)
- **Date** : 2026-09-30
- **Auteur(s)** : jprotin
- **Tags** : agents, sécurité, voix

## Retrait

Implémentée puis retirée le jour même : l'utilisateur n'a pas l'usage de tâches
confiées à un worker produisant des branches git. Le code reste dans l'historique
(commit 7077711) si le besoin revient.

## Contexte

Les agents « consignes » (ADR 0003) ne font que répondre. L'utilisateur veut aussi des
agents qui **agissent** sur ses projets : mettre à jour une documentation, écrire des
tests, appliquer une correction. ai-to-boost dispose déjà d'un worker agentique
(`claude-agent`, service de l'hôte, port 8089) : `claude -p` avec outils, dans un git
worktree, sur une branche `agent/<id>`, sans push ni fusion, avec un mode `file`
(Read/Edit/Write) et un mode `build` (shell sous garde-fou).

Deux risques propres à antares : une transcription vocale erronée qui déclenche une
action, et un LLM local qui « annonce » un lancement sans l'avoir fait.

## Options envisagées

### Option 1 : outils d'action donnés au LLM de conversation (appel de fonctions)

- **Pour** : conversation fluide.
- **Contre** : gemma4:e4b décide seul de lancer ; fiabilité insuffisante, et rien
  n'empêche une action sur une phrase mal transcrite.

### Option 2 : worker ai-to-boost, déclenchement explicite (bouton ou phrase), confirmation « oui »

- **Pour** : réutilise un exécuteur déjà isolé (worktree, branche dédiée, pas de push,
  dépôt d'orchestration interdit) ; la décision reste à l'utilisateur ; le dialogue de
  lancement est déterministe (sans LLM).
- **Contre** : syntaxe imposée à la voix (« lance l'agent X… ») ; texte envoyé chez
  Anthropic.

### Option 3 : exécution locale (LLM local + outils dans un conteneur antares)

- **Pour** : 100 % local.
- **Contre** : qualité insuffisante des modèles locaux pour modifier du code ; second
  exécuteur à sécuriser.

## Décision

Nous retenons l'**option 2**, en **mode `file` uniquement** (aucune commande exécutée).

- Un agent porte `kind: action` et, en option, un projet du worker (`repo`). Il ne se
  choisit pas comme agent d'appel ; il se lance.
- **Écrit** : bouton « Lancer un agent » (agent, projet, tâche). **Voix et écrit** :
  « lance l'agent X [sur le projet Y], pour … » : le routeur répond sans LLM en répétant
  la tâche et le projet, puis lance sur « oui » (« non » annule ; une autre phrase ou
  3 minutes sans réponse oublient la demande).
- Le routeur suit l'action (`/data/actions.json`) ; l'interface affiche une carte
  (résumé, fichiers, branche) et, pendant un appel, fait annoncer la fin par l'assistant.
- Jeton `AGENT_TOKEN` côté routeur uniquement ; badge « hors local ».

## Conséquences

### Positives

- Aucune action sans geste explicite ; rien n'arrive sur une branche de travail sans
  relecture humaine.
- Pas de nouvel exécuteur à sécuriser.

### Négatives / Coûts

- Dépendance au worker (service de l'hôte) et aux projets initialisés dans ai-to-boost.
- Un job à la fois (le worker sérialise) ; ~1 minute pour une petite tâche.
- L'état des jobs est en mémoire côté worker : un redémarrage marque l'action « perdue ».

### Neutres / À surveiller

- Les branches `agent/<id>` s'accumulent dans les dépôts : à fusionner ou supprimer.
- Le mode `build` (tests exécutés) pourra être ouvert plus tard, par un nouvel ADR.

## Alternatives non explorées (et pourquoi)

- **Pipelines BMAD du worker** (multi-personas) : trop lourds pour une tâche dictée.

## Références

- ADR 0003 (agents consignes), ADR 0006 (fiches de connaissance)
- ai-to-boost : `services/claude-agent/claude_agent.py` (API `/jobs`, `/projects`)
