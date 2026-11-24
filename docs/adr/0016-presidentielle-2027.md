# 0016 — Présidentielle 2027 : fiches relues dans un dépôt séparé, assistant fait de citations, quiz dans le navigateur

- **Status** : proposée (en attente de l'acceptation par l'utilisateur)
- **Date** : 2026-11-23
- **Auteur(s)** : jprotin
- **Tags** : architecture, données, RAG, neutralité, données personnelles

> **En bref** — La page « Présidentielle 2027 » présente les candidats avec des fiches
> identiques, répond aux questions et propose un quiz, sans jamais recommander de vote.
> Nous retenons des **fiches structurées, relues puis publiées dans un dépôt git séparé**
> d'antares_ai. L'assistant ne montre **que des citations relues**, choisies par un seul
> modèle local inscrit sur une liste blanche, et il **attend la fin d'un appel vocal**.
> Le quiz est calculé dans le navigateur. Entre les deux tours, tout se réduit aux deux
> qualifiés ; après le 2 mai 2027, la base est figée. Chaque fiche garde la trace de ses
> versions et de celles des programmes, comparées mot pour mot. Décision à accepter par
> l'utilisateur.

## Contexte

Antares sait déjà chercher dans des documents (RAG, ADR 0002 et 0010) et citer ses
sources. Déposer les programmes dans un projet RAG suffirait pour poser des questions.
Cela ne donnerait ni un gabarit identique pour chaque candidat, ni la position de chaque
candidat sur chaque question du quiz.

La neutralité impose des citations datées, classées par niveau de source (officiel
État, document du candidat, vote réel) et relues. Le risque le plus grave est
d'attribuer à un candidat la mesure d'un autre, avec une vraie source à l'appui.

Les réponses au quiz et les questions posées révèlent des opinions politiques. Ce sont
des données sensibles au sens du RGPD (règlement européen sur les données
personnelles, article 9). Pendant un partage, la page est ouverte aux invités, et leurs
questions traversent ngrok.

Enfin, la voix reste prioritaire : la carte graphique de 12 Go ne peut pas servir en même
temps un appel vocal et une génération longue.

## Options envisagées

| Option                                            | En une phrase                                                 | Principal avantage                     | Principal inconvénient                         |
| ------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------- |
| 1. Tout dans le RAG                               | Programmes déposés dans un projet RAG, conversation existante | Presque rien à coder                   | Pas de gabarit, ni de quiz, ni de vérification |
| 2. Fiches versionnées et index des passages relus | Fichiers validés, relus, publiés dans git ; index tiré d'eux  | Gabarit, quiz et citations vérifiables | Saisie et relecture longues                    |
| 3. Base SQLite éditée dans l'interface            | Même modèle, saisi dans Antares                               | Saisie confortable                     | Écran d'édition et historique à construire     |

## Décision

Nous proposons l'**option 2**, avec huit règles.

1. **Dépôt de données séparé.** Les vraies fiches vivent dans un dépôt git à part
   (`PRESIDENTIELLE_DATA`), monté en lecture seule dans le routeur. antares_ai ne
   contient que le jeu fictif (quatre candidats inventés). Seul l'outil de saisie
   (`presidentielle.sh`) écrit dans ce dépôt ; il ne lance jamais git, il affiche la
   commande à lancer après relecture.
2. **Publication après relecture.** Le modèle local propose un brouillon. Le
   propriétaire le relit, le vérifie, puis le publie. L'affichage, le quiz et
   l'assistant ne lisent que les fiches publiées.
3. **Liste blanche de modèles.** L'assistant et l'extraction n'utilisent que
   `gemma4:e4b`, par Ollama ou LiteLLM, inscrit dans `base.yaml`. Claude, Olala ou un
   modèle distant sont refusés, sans repli. La recherche web est coupée.
4. **Citations seules.** Le modèle ne renvoie que des identifiants de passages. Le code
   relit chaque passage dans la fiche publiée et l'affiche en entier, avec sa source.
   Aucun mot du modèle n'est affiché. Questions de vote, de classement ou de sondage :
   refus fixe, sans modèle.
5. **Mise en attente pendant un appel.** Pendant un appel vocal, l'assistant et
   l'extraction répondent « attente » ; la question est reposée après l'appel.
6. **Quiz dans le navigateur.** La règle de calcul publiée sur la page Méthode tourne
   dans le navigateur. Les réponses restent dans le stockage local, effaçables. Rien
   n'est envoyé au routeur. Le rapport utilise le composant Progress de shadcn : aucune
   bibliothèque de graphiques, CSP inchangée.
7. **Évolution en texte brut.** L'outil fige chaque version publiée d'une fiche dans
   `historique/<candidat>/v<N>.yaml` et écrit le texte de chaque document dans
   `textes/<empreinte>.txt`, tous deux versionnés dans le dépôt de données (les
   documents eux-mêmes restent hors git). Une nouvelle version d'un programme désigne
   celle qu'elle remplace (`source ajouter --remplace`, champ `remplace` contrôlé : même
   candidat, une seule remplaçante, pas de boucle). L'onglet « Évolution » de chaque
   fiche montre la frise des versions et compare deux versions d'un programme mot pour
   mot ; aucun résumé par le modèle, aucun qualificatif. La comparaison est calculée par
   le routeur (`difflib`) : un programme pèse plusieurs centaines de milliers de
   caractères, qu'un invité devrait sinon télécharger deux fois par le tunnel, et
   l'interface n'ajoute aucune dépendance. Les versions jamais capturées ne sont pas
   récupérables. Une mesure retirée parce qu'erronée (citation fausse, mal attribuée,
   hors contexte) est désignée à la publication (`publier --retrait-erreur <mesure>…`,
   refusé si la mesure manque à la version publiée ou reste dans le brouillon) et
   inscrite au journal (`retraits_erreur`) : l'évolution n'en montre plus que la date
   du retrait, dans toutes les versions qui la contenaient, sans citation ni source.
   Les copies figées ne sont pas réécrites : le texte erroné reste lisible par le
   propriétaire dans git, plus par les visiteurs.
8. **Deux thèmes de fiche hors quiz.** Aux 10 thèmes du quiz s'ajoutent
   `culture` (« Culture, sport et vie associative ») et `solidarites` (« Famille et
   solidarités »), qui ne servent qu'aux fiches, à l'assistant, à l'index et à l'onglet
   « Évolution ». Sans eux, les mesures de ces domaines, présentes dans les programmes,
   n'auraient pas de place ou seraient rangées dans un thème voisin. Ils restent hors
   de la grille (aucune question, aucun axe, aucune place dans le rapport) : la grille
   garde ses 10 thèmes de poids égal, et un thème peu abordé par certains candidats ne
   pèse pas sur la proximité. Une grille qui en contient un est refusée ; une mesure de
   ces thèmes ne peut être rattachée à aucune question.

Le calendrier suit trois phases, calculées par le routeur :

- **avant le premier tour** : tous les candidats déclarés, puis la liste officielle ;
- **entre les deux tours** : seuls les deux qualifiés restent dans la liste, le quiz,
  l'assistant et l'index ; une question compte dès qu'un des deux y a une position ;
- **archive**, à partir du 3 mai 2027 à 0 h, heure de Paris : base figée, plus aucune
  publication sauf correction inscrite au journal ; la surveillance des sites s'arrête ;
  l'assistant et le quiz restent consultables.

<details markdown="1">
<summary>Détails techniques : fichiers, routes, phases, tests</summary>

**Routeur** (`deploy/s2s/router/`)

- `presidentielle.py` : lecture de la base, cache, version, phase effective
  (`phase_effective`, `selon_phase`), couverture des questions.
- `presidentielle_api.py` : routes `GET /api/presidentielle`, `/meta`, `/quiz`,
  `/nouveautes` ; `POST /ask`, `/index`, `/extraire`. Invités d'un partage : lecture et
  `ask` seulement. Écritures sous la garde de l'origine (`write_guard.py`).
- `presidentielle_assistant.py`, `presidentielle_index.py` : assistant et index des
  passages (collections `proj-p27-*` du RAG intégré, sinon recherche par mots).
- `presidentielle_tool.py` et `deploy/s2s/presidentielle.sh` : outil de saisie.
- `presidentielle_votes.py` : votes réels de l'Assemblée, sur une liste de scrutins
  gelée avant de regarder les votes.
- `presidentielle_evolution.py` : routes `GET /api/presidentielle/evolution/<candidat>`
  et `…/comparaison?de=&a=`, ouvertes comme la base (invités compris, deux qualifiés
  entre les tours) ; lit `historique/` et `textes/`, jamais `documents/`. Bornes :
  1 million de caractères et 10 000 paragraphes par texte, 1 500 passages et 2 millions
  de caractères renvoyés, une comparaison calculée à la fois (attente de 2 s, puis 503),
  aucune comparaison hors cache pendant un appel vocal (409), résultats en cache (50
  millions de caractères au plus). Un calcul s'arrête si un appel vocal commence (409)
  ou au bout de 20 s (422, mémorisé une heure) : il tourne dans le pool de fils du routeur et
  s'interroge en continu, plus simple et plus sûr qu'un processus à part. Une
  apparition n'est jamais datée si le texte d'une version antérieure manque.
- Forme publiée d'une mesure et d'une source : une seule (`presidentielle.py`,
  `mesure_publiee`, `source_publiee`), reprise par la fiche, l'assistant et l'évolution ;
  la marque « entre les deux tours » n'est posée qu'une fois la base passée à
  `entre_tours`.
- Thèmes des fiches hors quiz (règle 8) : `THEMES_HORS_QUIZ` dans
  `presidentielle_schema.py` (repris par `presidentielle.py`) ; thèmes admis pour une
  mesure ou un vote = thèmes de la grille ∪ hors quiz (`schema.themes_admis`, routeur
  et `presidentielle_tool.py`) ; `controler_grille` refuse un thème hors quiz,
  `controler_rattachements` (donc `rattacher`) une mesure hors quiz ;
  `GET /api/presidentielle` sert les thèmes de la grille puis `culture` et `solidarites`
  (`hors_quiz: true`, `axe: null`), dans cet ordre ; `/quiz` ne les sert pas ;
  libellés et mots-clés de l'assistant dans `THEMES_REFERENCE` ; `extraire` les propose
  au modèle après ceux de la grille.
- Grille du quiz absente ou en défaut : thèmes déduits des mesures publiées (libellés
  de référence de l'outil, sinon l'identifiant), reconnus par l'assistant ; aucune
  mesure n'est masquée (grille en défaut : un thème inconnu est signalé, la fiche reste
  servie) ; `/quiz` répond « La grille du quiz n'est pas encore publiée. » ou « … est en
  cours de correction. ».
- Index par le sens : la reconstruction ne supprime que les collections des candidats
  connus et celles de l'index précédent ; recherche en parallèle (six requêtes à la
  fois), candidats sans mesure sautés, classement par score puis tirage.
- nginx : débit limité par compte du partage (`x-antares-user`, 60 requêtes par minute,
  aucune limite en local) ; délai de l'assistant 240 s, au-delà du pire cas du routeur
  (20 s de recherche, 20 s d'attente du tour, 150 s de modèle).
- `presidentielle_eval.py` : 40 questions pièges ; seuils : aucune mauvaise attribution,
  au moins 90 % de refus corrects.

**Tâches** : `deploy/s2s/tasks/watch.py`, surveillance quotidienne des pages des
candidats ; elle signale, ne publie rien, et s'arrête en archive.

**Interface** : `web/src/features/presidentielle/` (Candidats, Assistant, Quiz,
Méthode), bandeaux « entre les deux tours » et « base figée au 2 mai 2027 » ; onglets
« Fiche » et « Évolution » (`Evolution.tsx` : Tabs, RadioGroup, Table de shadcn ; ajouts
soulignés, retraits barrés, aucune couleur de jugement).

**Phases**

- Phase effective : `archive` si le jour de Paris dépasse `archive_apres`
  (2027-05-02) ; sinon `base.yaml: phase` (`declares`, `officiel`, `entre_tours`).
- En archive, l'outil refuse `source`, `publier`, `restaurer`, `rattacher`, `index`,
  `liste-officielle`, `phase`, `surveillance`, `scrutins geler` et `votes` (`textes
reconstruire` reste permis : il recopie un texte déjà inscrit), sauf
  `--correction "<motif>"`, inscrit au journal. `POST /index` répond 409 sans motif ;
  l'assistant ne relance pas l'index de lui-même. L'archive garde les candidats de la
  dernière phase enregistrée (les deux qualifiés, ou tous sans entre-deux-tours).

**Tests** : `test_presidentielle_*.py` (routeur), `test_tasks_presidentielle_watch.py`
(tâches), `web/tests/unit/presidentielle*.test.ts` (Vitest),
`web/tests/e2e/presidentielle.spec.ts` (Playwright, P27-E-01 à P27-E-65) ;
`test_presidentielle_evolution.py` et `presidentielle-test-restaurer.sh` pour
l'historique (jeu fictif : deux versions de la fiche et du programme de Carla
Exemplia) ; `test_presidentielle_sans_grille.py` pour une base sans grille (jeu fictif
sans quiz/, et 27 fiches d'identité sans mesure, cas de la base réelle au départ).

**Retrait** : retirer l'entrée de `web/src/app/features.ts`, l'appel `include_router`
de `router.py` et les montages `/presidentielle` de `compose.yaml`, puis supprimer les
collections `proj-p27-*` dans Qdrant.

</details>

## Conséquences

### Positives

- Mêmes rubriques pour tous les candidats, vérifiées par des tests.
- Résultat du quiz reproductible et expliqué, testé par les exemples chiffrés de la spec.
- Mauvaise attribution bloquée : le texte affiché vient toujours de la fiche publiée.
- Historique complet des fiches dans git, retour arrière par `restaurer` ; le même
  historique est lisible par tous dans l'onglet « Évolution », sans git dans le routeur.
- Aucune dépendance nouvelle dans `web/`.

### Négatives / Coûts

- Relecture longue : une à deux heures par candidat.
- Qualité limitée de `gemma4:e4b` : les questions pièges sont à rejouer après chaque
  publication et chaque changement de modèle.
- Des gestes datés restent manuels : liste officielle en mars 2027, entre-deux-tours vers
  le 22 avril 2027 (guide d'exploitation).
- Dépôt de données plus lourd : un texte par version de document dans `textes/`. Les
  versions antérieures à la première capture ne sont pas récupérables, et la
  comparaison dépend de l'extraction du texte des PDF.

### Neutres / À surveiller

- Partage ouvert : les questions des invités transitent par ngrok, choix assumé.
- En déploiement cloud, le « modèle local » tourne sur la machine distante (bandeau).
- Les journaux du routeur ne gardent ni les questions ni les réponses.

## Ce que ça change

- Le propriétaire dépose un document, relit la fiche proposée, la publie, puis
  enregistre le dépôt de données dans git.
- L'utilisateur et ses invités voient des fiches identiques, un assistant qui ne fait que
  citer et un quiz vérifiable.
- Rien ne change pour les projets RAG ni pour la conversation existants.

## Alternatives non explorées (et pourquoi)

- **Comparateurs en ligne ou jeux de données associatifs comme base** : sources
  secondaires ; ils servent seulement à repérer des documents.
- **Positionnement des candidats calculé par le modèle** : ni reproductible, ni
  vérifiable.
- **Graphiques Recharts (shadcn Chart)** : ils injectent une balise `<style>` que la CSP
  bloque.

## Références

- Spec, plan et découpage : `.claude/features/presidentielle-2027/` (hors git)
- Guides : `docs/runbooks/presidentielle-exploitation.md`,
  `docs/runbooks/presidentielle-votes-et-surveillance.md`
- ADR 0002, 0006 et 0010 (RAG), 0009 (connexions), 0012 (interface, CSP), 0013 (tâches
  planifiées), 0015 (menu et pages)

## Glossaire

- **RAG** (génération augmentée par recherche) : le modèle répond à partir d'extraits
  retrouvés dans une base de documents.
- **Liste blanche** : liste fermée des seuls modèles acceptés pour cette page.
- **Dépôt de données** : dépôt git séparé qui contient les vraies fiches.
- **CSP** (politique de sécurité du contenu) : règle du navigateur qui limite les
  ressources autorisées.
- **ngrok** : service tiers qui ouvre un tunnel vers Antares pendant un partage.
- **Lignée** : suite des versions d'un même document de programme (`remplace`).
