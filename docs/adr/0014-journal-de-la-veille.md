# 0014 — Journal de la veille : l'avatar en parle, le routeur tient le conducteur

- **Status** : proposed (en attente de l'essai en appel réel)
- **Date** : 2026-11-17
- **Auteur(s)** : jprotin
- **Tags** : conversation, veille, voix, petit modèle

> **En bref** — L'avatar connaît la veille du jour : interrogé, il en parle avec ses mots,
> donne son avis et demande celui de l'utilisateur, sans jamais lire. Il présente aussi
> un « journal » à la voix. Le routeur choisit les sujets et tient le sujet courant ; à
> chaque tour, le modèle ne reçoit que l'étape et le sujet du moment, dans une note de
> régie collée au dernier message.

## Contexte

La veille (ADR 0013) est lue dans une fenêtre. L'utilisateur veut en parler à l'avatar :
qu'il réponde aux questions, propose un récapitulatif façon podcast, commente, demande
son avis et échange, sans lire les articles. Il veut le lancer depuis une petite fenêtre
avec l'avatar, en haut à gauche de la Veille, comme un journal télévisé.

Le modèle de la voix est gemma4:e4b (12 Go de VRAM partagés avec s2s). Sa consigne
système est déjà longue (personnage, mode, agent, RAG). Le relais vocal du routeur sait
déjà appliquer une phase en cours (répétition, ADR 0011).

## Options envisagées

| Option                              | En une phrase                                  | Avantage                                    | Inconvénient                                            |
| ----------------------------------- | ---------------------------------------------- | ------------------------------------------- | ------------------------------------------------------- |
| 1. Conducteur tenu par le routeur   | Phase en cours, une étape et un sujet par tour | Suivi fiable avec un petit modèle, testable | Intentions repérées par mots-clés (« passe », « stop ») |
| 2. Tout le journal dans la consigne | Six sujets d'un coup, le modèle mène           | Rien à coder côté routeur                   | Mesuré : un petit modèle saute, mélange ou invente      |
| 3. Texte du journal écrit d'avance  | Rédigé une fois, lu par l'avatar               | Débit maîtrisé                              | C'est une lecture : refusé par l'utilisateur            |

## Décision

Nous retenons l'**option 1**.

- `router/veille_journal.py` : détection des questions sur la veille (mots de l'actualité,
  des idées, de la météo, noms propres des titres) et résumé injecté (15 articles, ceux
  cités dans la question d'abord, idées, météo) avec la manière d'en parler. La
  recherche web n'est faite que si elle est demandée explicitement.
- Journal : 5 sujets (aimés d'abord, une catégorie différente tant que possible, jamais un
  article rejeté), puis 2 idées et une conclusion. Le dernier passage en échec est sauté.
  Intentions par tour : avis (réaction puis sujet suivant), question ou « raconte-m'en
  plus » (reste sur le sujet), « passe » (sujet suivant sans réagir), « stop »
  (conclusion).
- L'étape et le sujet vont dans une **note de régie** entre crochets ajoutée au dernier
  message, la consigne système gardant le personnage et les règles ; historique réduit
  aux deux derniers messages. Mesuré sur gemma4:e4b : avec l'étape à la fin de la
  consigne système, 3 sujets sur 5 étaient inventés ; avec la note de régie, 5 sur 5
  sont les bons.
- Interface : mini-fenêtre dans l'en-tête de la Veille (l'avatar y est déplacé, pas
  dupliqué : un seul rendu WebGL), bouton « Lancer le journal » qui démarre l'appel si
  besoin et envoie un message caché marqué `[Journal de la veille]` ; « Sujet suivant »,
  « Arrêter » (l'appel continue). État relu toutes les 1,5 s (`GET /api/veille/journal`)
  pour marquer le sujet « À l'antenne ». Le journal peut aussi partir à la voix.
- Les avis donnés à la voix ne deviennent pas des votes.

## Conséquences

- Positives : l'avatar parle de la veille sans la lire, le journal suit son conducteur
  avec le petit modèle, la logique est testée sans modèle (`test_veille_journal.py`,
  `test_router_veille.py`, `veille-journal.spec.ts`).
- Négatives : les intentions reposent sur des mots-clés (une réponse ambiguë fait passer
  au sujet suivant) ; une interruption pendant que l'avatar parle compte comme un tour ;
  phase globale au routeur (un seul journal à la fois, comme la répétition).
- Neutres : le résumé ajoute environ 1 500 jetons à la consigne quand la question parle de
  la veille.
