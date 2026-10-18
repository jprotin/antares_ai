# 0011 — Répétition de présentation : discours muet, questions du public, rapport noté

- **Status** : proposed
- **Date** : 2026-10-14
- **Auteur(s)** : jprotin
- **Tags** : voix, coaching, hors ligne

## Contexte

L'utilisateur veut répéter une soutenance client ou un talk : il déroule son discours
en faisant défiler ses slides, l'avatar lui pose ensuite des questions, puis présente un
rapport (note, ce qu'il faut améliorer pas à pas, ce qu'il ne faut pas dire). Le tout
doit rester local et passer par le moteur vocal existant (HF speech-to-speech).

Contrainte découverte : le moteur demande une réponse au LLM à chaque pause, sans option
côté serveur pour s'en passer (`create_response` n'existe que côté client Python). De
plus, une parole restée sans réponse rouvre le même tour (`unanswered_reopen_ms`,
7 s) : chaque transcription reprend tout le tour depuis son début.

## Options envisagées

### Option 1 : un seul appel vocal, phase appliquée par le routeur

- **Pour** : rien à changer au moteur ; le routeur renvoie une réponse vide pendant le
  discours, remplace la consigne pendant les questions (public joué, slides et discours
  en contexte, tours du discours retirés) et renvoie le texte prévu pour la lecture du
  rapport (avatar, voix et effets inchangés).
- **Contre** : transcriptions cumulatives à découper côté interface ; latence de
  transcription qui croît doucement avec la longueur du tour (0,03 s → 0,3 s mesurés
  sur 3,5 min, extrapolé ~1,5 s à 20 min, sans effet sur le relevé).

### Option 2 : enregistrer le discours hors du moteur (STT séparé)

- **Pour** : aucune réponse à neutraliser, découpage net.
- **Contre** : second chemin de transcription à maintenir, VRAM supplémentaire ou
  transcription sur le processeur bien plus lente ; deux connexions audio à enchaîner.

### Option 3 : abaisser `unanswered_reopen_ms` du moteur

- **Pour** : tours courts, transcriptions non cumulatives.
- **Contre** : change le comportement de toutes les conversations (reprise de parole
  pendant la réflexion du LLM), pour un seul usage.

## Décision

Nous retenons l'**option 1**.

- `router/rehearsal.py` : stockage `/data/rehearsals/<id>/` (meta.json + slides JPEG
  via `pdftoppm`, texte par `pdftotext`), phase en cours en mémoire (`/api/rehearsals/
live`, expire après 3 h, remise à zéro au chargement de l'interface).
- Questions : public type (client exigeant, jury, conférence, comité de direction) ou
  agent existant ; N questions, une relance si la réponse est vague, aucun avis avant le
  rapport. La consigne de l'avatar (personnage) est remplacée par des règles orales
  neutres : le public ne parle pas comme le Terminator.
- Rapport : rédigé par le modèle choisi dans les Réglages (local par défaut, Claude si
  choisi) en JSON ; la note /20 est la somme de 5 critères notés sur 4, recalculée par le
  routeur ; mesures (durée, débit, temps par slide, slides survolées, mots de
  remplissage) calculées par le routeur, pas par le modèle. Texte lu découpé par
  section, surlignée pendant la lecture.
- Slides en PDF seulement (export depuis PowerPoint, Keynote, Google Slides).
- Historique local avec progression des notes par titre ; impression / PDF du rapport.
- Bruit ambiant (retour d'usage : la détection était trop sensible) : calibrage de 3 s
  avant le discours, puis filtre côté interface (`noise-gate.js`) : sous le seuil (bruit
  mesuré × 2 à 4,5 selon le réglage Léger / Normal / Fort), le moteur reçoit du silence.
  Le seuil de détection de parole du moteur passe de 0,6 à 0,7 à 0,88 pendant la
  répétition (`session.update`), et chaque appel renvoie ensuite la valeur par défaut.
  Les bribes d'au plus 2 mots en moins d'une seconde sont écartées de l'analyse.
- Micro coupé tant que l'avatar parle (questions, rapport, discussion), plus 300 ms
  d'écho ; bouton **Interrompre** puisqu'on ne peut plus lui couper la parole.
- Discussion du rapport, à l'écrit ou à la voix (phase `discussion` : le routeur traite
  la parole et renvoie la réponse à lire). Le coach juge l'argument ; une note ne bouge
  que sur un fait nouveau ou une erreur de sa part, à la hausse comme à la baisse.
  Garde-fous calculés par le routeur, pas par le modèle :
  - chaque critère reste à ±1 point de sa note d'origine sur toute la discussion :
    répéter un argument ne fait pas monter la note ;
  - une durée citée par l'orateur (« 30 secondes ») est confrontée à la durée mesurée :
    en cas de dépassement, le rythme ne peut pas monter, et seul le rythme peut
    changer ;
  - la phrase chiffrée (« Je révise donc… Votre note passe à… ») est rédigée par le
    routeur à partir des révisions appliquées : l'écran et la voix disent la même chose.
    Note d'origine, échanges et révisions sont conservés dans `meta.json` ; le rapport
    n'affiche qu'une ligne (« Note révisée… · Voir l'historique ») et l'impression ajoute
    les révisions en annexe.

## Conséquences

### Positives

- Aucun changement du moteur ni de l'image ; tout reste local.
- Mesuré (gemma4:e4b, 5 slides, 3 questions) : rapport en 16 à 19 s ; questions
  pertinentes (citation de slide, incohérence 99,95 % / coupure d'une nuit relevée).

### Négatives / Coûts

- Débit et tics de langage approximatifs : Parakeet efface souvent les « euh » et peut
  retranscrire un mot autrement (« Planning » → « Opening »).
- Un discours de plus de ~60 000 caractères (slides + discours + questions) est refusé
  explicitement plutôt que tronqué.

### Neutres / À surveiller

- Discours de 30 min et plus non mesurés (latence de transcription croissante).
- La qualité du jugement dépend du modèle : gemma4:e4b note parfois le rythme
  « trop rapide » malgré un débit dans la norme. En discussion, il raisonne mal sur
  les durées (il a remonté le rythme quand la durée visée annoncée était plus courte)
  et annonçait des notes absentes de ses révisions : d'où les garde-fous ci-dessus.
- Filtre de bruit : une voix proche et forte (collègue à côté) reste de la parole et
  peut passer ; le réglage **Fort** relève le seuil.

## Références

- ADR 0001 (moteur temps réel), ADR 0003 (agents), ADR 0005 (documents, refus
  explicite)
- `deploy/s2s/router/rehearsal.py`, `frontend/rehearsal.js`
