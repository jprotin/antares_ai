# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

## [Non publié]

### Ajouté

- Ossature à menu et pages (ADR 0015) : menu accordéon à gauche (shadcn Sidebar,
  repliable, tiroir sur mobile) avec Accueil, Conversation, Répétition, Actualités et
  Réglages en pied ; une adresse par page (`#/reglages/agents`) ; tableau de bord
  d'accueil (météo, assistant, top 5 du jour et de la semaine, idées, dernière
  répétition) ; l'appel continue d'une page à l'autre. Les icônes de la barre du haut
  (Répétition, Veille, Réglages) sont remplacées par le menu.
- Veille IA et météo (ADR 0013) : service `antares-tasks` qui lit des flux RSS et Atom à
  8 h, 13 h et 18 h, fait résumer les nouveautés et proposer des idées par le modèle des
  Réglages, relève la météo à chaque passage ; bouton avec pastille et fenêtre plein
  écran dans l'interface web (coupée pendant un partage).
- Refonte de la veille : 46 flux tech, IA, cloud et informatique (FR et
  EN), une vingtaine d'articles filtrables par catégorie, source et langue, votes
  « J'aime / Je n'aime pas » qui orientent les passages suivants, six idées pour Antares
  avec « Intéressé / Pas intéressé », prompt pour Claude Code en fenêtre avec copie en un
  clic, grande météo illustrée (SVG embarqués). Votes et prompts dans `veille.db` du
  routeur ; volume `antares-tasks-data` externe, créé par `install.sh`.
- Veille, suite : 65 flux dont les brèves de Korben, sources ajoutées, désactivées ou
  privilégiées depuis l'interface, une trentaine d'articles à la une avec une part
  garantie par catégorie, onglet « Tous les articles » (non retenus, votables), fiche
  d'article avec traduction en français et lien vers l'original, navigation entre
  passages ou toute la journée, bouton « Nouveau passage », fenêtre
  « Statistiques » (goûts, choix de l'IA, taux d'accord, articles ratés). Pendant un
  partage ngrok : veille lisible par les invités, modifiable par le propriétaire
  (`SHARE_OWNER_EMAIL`).
- Journal de la veille (ADR 0014) : l'avatar parle de la veille du jour quand on l'interroge
  (sans lire les articles : il raconte, donne son avis et demande le vôtre) et présente
  un journal à la voix depuis une mini-fenêtre en haut à gauche de la Veille, ou sur
  « fais-moi le journal » : météo, 5 sujets avec échange, idées, conclusion ; sujet en
  cours marqué « À l'antenne ».
- `FEATURES.md` (fonctionnalités et backlog d'Antares) et `deploy/s2s/.env.example`.

### Modifié

- Interface web réécrite en Vite + React + shadcn/ui + TypeScript (`web/`), servie sur
  127.0.0.1:8765 à l'identique de l'ancienne ; retour arrière par
  `deploy/s2s/ui.sh legacy` (ADR 0012).

### Sécurité

- La page ne peut plus être intégrée dans un site tiers (`frame-ancestors 'none'`,
  `X-Frame-Options DENY`) ; CSP complétée (`base-uri`, `object-src`, `form-action`).

### Corrigé

- Flash du thème clair au chargement ; contextes WebGL non libérés au changement
  d'avatar ; erreurs d'API non affichées dans les fenêtres de gestion.
