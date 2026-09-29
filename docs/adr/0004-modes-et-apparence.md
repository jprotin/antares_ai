# 0004 — Modes de conversation, sélection sur l'écran d'appel et nuances par domaine

- **Status** : accepted
- **Date** : 2026-09-29
- **Auteur(s)** : jprotin
- **Tags** : interface, LLM, accessibilité

## Contexte

Avec 28 agents (ADR 0003), l'agent devient le choix principal d'un appel ; le cacher
dans les Réglages obligeait à ouvrir une fenêtre à chaque changement. L'utilisateur
veut aussi des modes de conversation (Support, Expert, Cool…), une charte graphique
qui suive l'agent sans écart de couleur marqué, et un thème clair en plus du sombre.
Les fenêtres devaient se fermer au clic extérieur et s'adapter au mobile.

Deux dimensions se superposent : l'**expertise** (l'agent) et la **manière** de
répondre (le ton, la structure). La couleur ne peut en suivre qu'une sans devenir
illisible.

## Options envisagées

### Option 1 : couleur par mode, agent dans les Réglages

- **Pour** : le mode se voit d'un coup d'œil.
- **Contre** : l'agent, choix le plus fréquent, reste caché ; palettes très
  différentes d'un mode à l'autre.

### Option 2 : agent et mode sur l'écran d'appel, couleur par domaine d'agent

- **Pour** : les deux choix sont à un clic, pendant l'appel ; la nuance rappelle le
  domaine sans rompre la charte (seule la teinte varie).
- **Contre** : le mode ne se lit que sur son libellé.

### Option 3 : fusionner modes et agents

- **Pour** : un seul choix.
- **Contre** : explosion combinatoire (chaque agent décliné par ton).

## Décision

Nous retenons l'**option 2**.

- **Modes** (`router/modes.py`) : Standard, Support / Helpdesk, Expert technique,
  Cool / Relax, Incident / Astreinte, Coach / Formateur, Brainstorming, Avocat du
  diable. Réglage `mode` ; consigne assemblée dans l'ordre mode, agent, documentation.
  Chaque mode liste les utilités d'agents suggérées en tête de liste.
- **Écran d'appel** : deux listes déroulantes en haut du bloc de l'orbe (agent groupé
  par domaine avec recherche, mode). Les Réglages ne gardent que la gestion des agents.
- **Nuance** : `--hue` (CSS) et l'orbe suivent le domaine de l'agent actif, dans une
  plage de 182 à 276° autour du bleu de base (222°) ; luminosité et saturation
  communes. Domaines personnels : teinte dérivée du nom dans la même plage.
- **Thème** : sombre, clair ou système, mémorisé dans le navigateur. En clair, l'orbe
  remappe ses couleurs vers des tons lumineux et saturés (les teintes sombres du thème
  sombre y paraissaient grises).
- **Fenêtres** : fermeture au clic sur le fond (clic commencé et fini hors du contenu)
  ou Échap ; en-tête et actions fixes ; plein écran sous 640 px.

## Conséquences

### Positives

- Agent et mode changeables en un clic, même en cours d'appel (appliqués à la phrase
  suivante).
- Charte cohérente : nuances proches, contrastes identiques entre domaines.
- Vérifié par captures (Chrome headless) : sombre, clair, listes ouvertes, fenêtres,
  mobile 390 px.

### Négatives / Coûts

- `color-mix()` et `@property` exigent un navigateur récent (Firefox 128+, Chrome 111+).
- Le thème est mémorisé par navigateur, pas côté serveur.

### Neutres / À surveiller

- Domaines de l'ADR 0003 : le catalogue en compte désormais 8 (ajout de
  « Exploitation / SRE »).

## Références

- `deploy/s2s/router/modes.py`, `frontend/picker.js`, `frontend/theme.js`,
  `frontend/orb.js`
- ADR 0003 (agents consignes)
