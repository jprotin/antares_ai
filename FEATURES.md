# Antares : fonctionnalités

Plateforme d'IA vocale (voix vers voix) qui tourne sur le poste, sans cloud par défaut.
Ce fichier est relu par la veille IA pour proposer des idées : à tenir à jour à chaque
fin de feature, sous 4 000 caractères.

## Appel vocal

- Appel temps réel dans le navigateur : reconnaissance Parakeet, modèle de langage,
  synthèse Qwen3-TTS avec voix clonées ; réponse en ~1 s sur une carte de 12 Go.
- Moteur vocal isolé d'Internet (réseau Docker interne), preuve par `check-local.sh`.
- Avatars (orbe, Terminator, Chappie, Bender) liés à leur voix ; voix personnelles hors git.
- Sous-titres, demi-duplex, filtre de bruit, code dicté affiché à l'écran.

## Écrit et documents

- Conversation écrite pendant ou hors appel, même agent et même documentation.
- Documents joints (PDF, texte) lus en entier ; réponses en markdown, schémas Mermaid.

## Connaissances

- RAG des projets (ai-to-boost ou RAG intégré), extraits ajoutés à chaque question.
- Fiches de connaissance rédigées par le modèle puis indexées.
- Recherche web locale (SearXNG), mode hors ligne détecté.

## Modèles et réglages

- Connexions : fournisseurs Ollama et API compatibles OpenAI, modèle et repli choisis
  dans l'interface ; Claude en option par le pont de l'hôte.
- Agents « consignes » et modes de réponse (ton, structure).
- Répétition de présentation : slides, discours, questions du public, rapport noté.
- Partage temporaire par ngrok : fonctions privées coupées pendant le partage.

## Veille IA et météo

- Service `antares-tasks` : veille à 8 h, 13 h et 18 h sur 65 flux FR et EN (IA, cloud,
  dev, sécurité, matériel, recherches Google News) ; sources ajoutées (site, flux ou
  sujet), désactivées ou privilégiées (étoile : places garanties) depuis l'interface,
  une trentaine d'articles à la une filtrables et 6 idées pour Antares.
- Navigation entre passages ou toute la journée, onglet « Tous les articles » (non
  retenus par l'IA, votables), fiche d'article avec extrait, traduction en français d'un
  clic et lien vers l'original, bouton « Nouveau passage » (sans doublon).
- Statistiques : goûts, choix de l'IA, taux d'accord et articles ratés par jour.
- Votes j'aime / je n'aime pas et intéressé / pas intéressé : ils orientent les passages
  suivants ; prompt Claude Code d'une idée retenue, copiable en un clic.
- Météo illustrée à chaque passage (temps actuel, 12 prochaines heures).

## Interface

- Vite + React + shadcn/ui, CSP stricte, thème clair et sombre, tests Playwright.

## Backlog

- Archive et historique des appels (conversation perdue au rechargement).
- PDF scannés (reconnaissance de caractères).
- Correctif de la voix dégradée sous Chrome lors des appels longs.
- Cible cloud (VM avec GPU) et installation sur un autre poste.
- Serveurs MCP utilisables par les agents.
