# 0015 — Ossature à menu et pages : shadcn Sidebar, adresses en « # »

- **Status** : proposed (en attente des retours visuels)
- **Date** : 2026-11-18
- **Auteur(s)** : jprotin
- **Tags** : interface, navigation, shadcn

> **En bref** — L'interface passe d'un écran d'appel unique, avec des fenêtres ouvertes
> par des icônes, à un menu accordéon à gauche (shadcn Sidebar) et des pages : Accueil
> (tableau de bord), Conversation, Répétition, Actualités, et Réglages en pied de menu.
> Chaque page a son adresse (`#/reglages/agents`). Les écrans existants sont repris tels
> quels dans les pages ; l'appel continue d'une page à l'autre.

## Contexte

Les fonctions se sont accumulées sur l'écran d'appel : Veille, Répétition, Réglages,
Agents, Connexions, Projets RAG, Connaissances, chacune dans une fenêtre. L'utilisateur
veut un menu accordéon à gauche, une page par fonction, un tableau de bord d'accueil, la
place pour de futurs menus, et le respect strict de shadcn/ui. L'interface est servie
par nginx en fichiers statiques, sous une CSP stricte (ADR 0012).

## Options envisagées

| Option                      | En une phrase                         | Avantage                                    | Inconvénient                                         |
| --------------------------- | ------------------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| 1. Adresses en « # » maison | `#/page/sous-page` lu dans le store   | Aucune dépendance, rien à régler côté nginx | Pas de chargement différé des pages                  |
| 2. React Router             | Bibliothèque de routage complète      | Outillage connu                             | Dépendance de plus pour quelques adresses fixes      |
| 3. Garder les fenêtres      | Menu qui ouvre les fenêtres actuelles | Aucun écran à adapter                       | Pas de pages, pas d'adresse, ne répond pas au besoin |

## Décision

**Option 1.** Le registre des fonctionnalités (`app/features.ts`) gagne un champ `page` :
titre, icône, rang, place (haut ou pied du menu), contenu, sous-pages, pastille. Le menu
(`app/AppSidebar.tsx`) et la page affichée (`app/AppShell.tsx`) en découlent ; ajouter un
menu revient à déclarer une page dans une fonctionnalité.

- Composants shadcn ajoutés par le CLI (`sidebar`, `card`, `collapsible`, `breadcrumb`,
  `separator`, `sheet`, `tooltip`, `skeleton`, `accordion`, `scroll-area`), jetons
  `--sidebar-*` dérivés des couleurs antares.
- Un écran s'affiche en fenêtre ou en page (`app/surface.ts`) : en page, son titre reste
  et le bouton Fermer disparaît. Réglages, Agents, Connexions, Projets RAG et
  Connaissances deviennent des sous-pages des Réglages ; la Répétition et la Veille des
  pages. Les petites fenêtres (fiche d'article, prompt, statistiques, sources, fiche de
  connaissance) restent des fenêtres.
- La sortie audio est montée par l'ossature : changer de page ne coupe pas l'appel. Un
  encart « Appel en cours » dans le menu permet de raccrocher de partout.
- Accueil : météo, assistant (appel en un clic), top 5 du jour et de la semaine, idées du
  jour, dernière répétition. Aucune nouvelle route du routeur.

## Conséquences

### Positives

- Une adresse par écran (liens directs, retour arrière), menu repliable en icônes et
  tiroir sur mobile, ajout d'un menu sans toucher à l'ossature.

### Négatives / Coûts

- La suite Playwright commune (ADR 0012) ne compare plus les fenêtres des deux
  interfaces : l'adaptateur de la nouvelle navigue par le menu, et les vérifications
  propres aux fenêtres (Échap, Annuler, focus rendu) ne valent que pour l'ancienne.
- Les icônes de la barre (Répétition, Veille, Réglages) sont retirées au profit du menu.

### Neutres

- L'ancienne interface (`frontend/`, `./ui.sh legacy`) n'est plus le reflet de la
  nouvelle : son retrait relève du nettoyage prévu après cette refonte.
