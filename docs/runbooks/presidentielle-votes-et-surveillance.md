# Présidentielle 2027 : votes réels et surveillance des sites

Ce guide couvre le lot 4b de la page « Présidentielle 2027 » :

- la rubrique « ce qu'il a voté » des parlementaires, tirée des données ouvertes de
  l'Assemblée nationale ;
- la surveillance quotidienne des pages des candidats.

Deux gestes vous reviennent, parce qu'ils engagent la neutralité de la page :

- choisir les scrutins ;
- valider la liste des pages suivies.

Les outils sont prêts. Ils ne contiennent aucun scrutin réel ni aucune position réelle.

Toutes les commandes se lancent depuis `deploy/s2s/`. Elles écrivent dans le dépôt de
données (`PRESIDENTIELLE_DATA`), jamais dans antares_ai. Elles ne lancent jamais git :
elles affichent la commande à lancer après relecture du diff.

## 1. Choisir les scrutins (avant de regarder les candidats)

La liste est fixée **par thème, avant de regarder les votes de quiconque**, et la même
liste vaut pour tous les parlementaires. Les votes réels sont affichés sur la fiche. Ils
n'entrent jamais dans le calcul du quiz.

### Critères de choix

1. **Un à trois scrutins par thème de la grille** (`quiz/grille.yaml`, 10 thèmes), soit
   10 à 30 scrutins. Le même nombre par thème autant que possible.
2. **Vote sur l'ensemble d'un texte** (scrutin solennel ou scrutin public sur
   l'ensemble), de préférence aux amendements ou aux articles isolés, plus difficiles à
   lire sans contexte.
3. **Portée directe sur le thème** : le titre et l'objet du texte suffisent à le
   rattacher au thème, sans interprétation.
4. **Choix sur le titre et l'objet seulement.** Ne pas ouvrir le détail nominatif ni
   l'analyse par groupe avant d'avoir gelé la liste. Un scrutin n'est jamais ajouté ou
   retiré à cause du vote d'un candidat.
5. **Pas de motion de censure ni de vote de confiance** : ce sont des votes de soutien
   ou d'opposition au gouvernement, pas des positions sur un thème.
6. **Législature en cours (17e)**, et la 16e si un thème n'a aucun texte adapté dans la
   17e. L'import prend une archive par législature.
7. **Titre neutre** dans `quiz/scrutins.yaml` : l'intitulé officiel du texte, sans
   qualificatif.

### Trouver les scrutins

- Liste des scrutins d'une législature :
  `https://www.assemblee-nationale.fr/dyn/17/scrutins`. Le filtre « scrutins
  solennels » donne les votes sur l'ensemble des grands textes.
- Page d'un scrutin : `https://www.assemblee-nationale.fr/dyn/17/scrutins/<numéro>`.
  Elle donne le numéro, la date et l'intitulé. Ce lien va dans `url`.
- Données ouvertes : `https://data.assemblee-nationale.fr`, rubrique « Travaux
  parlementaires », jeu « Votes » (scrutins de la législature, format JSON). L'archive
  s'appelle `Scrutins.json.zip`. Pour la 17e législature, son adresse est de la forme
  `https://data.assemblee-nationale.fr/static/openData/repository/17/loi/scrutins/Scrutins.json.zip`.
  Vérifiez-la sur la page du jeu de données au moment du téléchargement.

### Écrire `quiz/scrutins.yaml`

```yaml
---
# Scrutins retenus le AAAA-MM-JJ, par thème, avant de regarder les votes des candidats.
# Critères : docs/runbooks/presidentielle-votes-et-surveillance.md (antares_ai)
scrutins:
  - id: sante-l17-1234 # identifiant libre : minuscules, chiffres et tirets
    theme: sante # un thème de quiz/grille.yaml
    legislature: 17
    numero: 1234
    date: 2025-01-28 # date du scrutin
    titre: Intitulé officiel du texte
    url: https://www.assemblee-nationale.fr/dyn/17/scrutins/1234
```

L'outil refuse :

- un lien hors du site de l'Assemblée ;
- un thème inconnu ;
- un identifiant ou un scrutin en double.

### Vérifier, faire valider, geler

```bash
./presidentielle.sh scrutins verifier   # erreurs, nombre de scrutins par thème
./presidentielle.sh scrutins geler      # après validation : date de gel et empreinte au journal
```

Le gel inscrit au journal la date et l'empreinte de la liste. Après le gel :

- toute modification de la liste fait échouer `verifier` et bloque l'import ;
- la liste doit être revalidée puis gelée à nouveau ;
- le journal garde la trace de chaque gel.

## 2. Importer les votes d'un député

1. Téléchargez l'archive de la législature (sur l'hôte, une fois) :
   `curl -fLo ~/Scrutins-L17.json.zip <adresse de l'archive>`.
2. Trouvez l'identifiant du député : `PA` suivi de chiffres, dans l'adresse de sa page
   (`https://www.assemblee-nationale.fr/dyn/deputes/PA…`).
3. Importez :

```bash
./presidentielle.sh votes importer <candidat> --acteur PA… --archive ~/Scrutins-L17.json.zip
# Deux législatures : --archive ~/Scrutins-L16.json.zip --archive ~/Scrutins-L17.json.zip
./presidentielle.sh verifier brouillons/<candidat>.yaml
./presidentielle.sh publier <candidat>
```

L'archive est montée en lecture seule. Elle n'est ni copiée dans le dépôt ni extraite.
L'import :

- lit **seulement les scrutins de la liste gelée** ;
- écrit leurs votes dans le brouillon (`brouillons/<candidat>.yaml`), qui reçoit
  `parlementaire: true` ;
- n'écrit rien dans `candidats/` ;
- ajoute à `sources.yaml` une source de niveau `vote_reel` par scrutin, avec le lien,
  la date et l'empreinte du fichier du scrutin.

Positions affichées :

| Position     | Dans l'archive                                      | Libellé               |
| ------------ | --------------------------------------------------- | --------------------- |
| `pour`       | `pours`                                             | Pour                  |
| `contre`     | `contres`                                           | Contre                |
| `abstention` | `abstentions`                                       | Abstention            |
| `non_votant` | `nonVotants`, `nonVotantsVolontaires`               | Non-votant            |
| `sans_vote`  | absent de toutes les listes (absence, hors mandat…) | Aucun vote enregistré |

Limites connues :

- `sans_vote` ne distingue pas une absence d'un mandat non en cours à la date du
  scrutin. Vérifiez les dates du mandat sur la page du député avant de publier.
- Les mises au point (intention de vote déclarée après le scrutin) ne changent pas le
  vote enregistré et ne sont pas lues.
- Le Sénat et le Parlement européen viendront plus tard.

Refus sans rien écrire :

- liste non gelée, ou modifiée depuis son gel ;
- scrutin absent de l'archive ;
- date différente de celle de la liste ;
- député absent de tous les scrutins (identifiant à vérifier).

## 3. Surveillance des pages des candidats

La tâche `presidentielle-watch` du service `antares-tasks` passe chaque jour à 07:30
(`presidentielle_watch` dans `tasks/tasks.yaml`). Pour chaque page de
`surveillance.yaml`, elle compare l'empreinte du texte visible à celle de la veille.

- Quand une page a changé, le propriétaire voit « Nouvelle source à relire » en tête des
  pages de la présidentielle. Les invités d'un partage ne voient rien, et la route leur
  est refusée.
- Le signalement disparaît quand la fiche du candidat est relue et publiée de nouveau
  un jour postérieur au changement (`relue_le` strictement après le jour du
  changement : une relecture le jour même garde le signalement, pour ne pas manquer un
  changement de l'après-midi).
- Une page retirée de `surveillance.yaml` n'est plus signalée.
- La tâche n'appelle aucun modèle et ne publie rien. Elle passe par les mêmes contrôles
  de redirection que la veille : https, nom public, adresses IP publiques. La taille et
  la durée sont bornées.
- Première visite : l'empreinte est notée, sans signalement.
- Erreur réseau : notée, sans signalement.
- Les sites rendus en JavaScript peuvent échapper à la détection, et des faux
  signalements sont possibles.
- Arrêt automatique en archive (après `archive_apres`), sur le jeu de démonstration, et
  tant que la liste n'est pas gelée.

### Quand la page d'un programme a changé

Le signalement ne dit pas ce qui a changé : il invite à relire. Si le candidat a publié
une **nouvelle version de son programme**, inscrivez-la comme remplaçant la précédente,
puis relisez la fiche :

```bash
./presidentielle.sh source ajouter <candidat> ~/programme-v2.pdf --niveau candidat \
  --titre "Programme présidentiel (version du AAAA-MM-JJ)" --url https://… \
  --publie-le AAAA-MM-JJ --remplace <ancienne_source_id>
```

L'onglet « Évolution » de la fiche compare alors les deux versions mot pour mot (guide
d'exploitation, section 7). Une version que la surveillance n'a pas vue passer, publiée
puis remplacée entre deux visites, n'est pas récupérable.

### Choisir et valider la liste des pages

Pour chaque candidat, une à trois pages au plus. La même nature de page pour tous :

- page du programme ou des propositions ;
- page des actualités ou des communiqués ;
- page des documents (PDF du programme), si elle existe.

```bash
./presidentielle.sh surveillance ajouter https://… --candidat <candidat>
./presidentielle.sh surveillance retirer https://…
./presidentielle.sh surveillance geler     # après validation de la liste complète
docker compose run --rm antares-tasks presidentielle-watch --dry-run   # essai, rien n'est noté
```

Le gel est daté au journal. Toute modification ultérieure dégèle la liste, et la
surveillance s'arrête jusqu'au gel suivant. Le passage du jour compte même s'il n'a rien
visité : une liste gelée après 07:30 est visitée pour la première fois le lendemain
(ou tout de suite avec `presidentielle-watch` lancé à la main).

Protections des requêtes sortantes (communes avec la veille) : https seulement, noms et
adresses IP publics contrôlés à chaque redirection, taille bornée après décompression
(gzip et deflate seulement, brotli refusé), aucun mandataire lu dans l'environnement.
Limite connue : le nom est résolu une seconde fois à la connexion ; un domaine piégé à
durée de vie DNS nulle pourrait viser un service interne par une requête GET dont le
contenu ne ressort pas (un signalement au plus).
