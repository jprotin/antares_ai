# Avatars photo (locaux, non versionnés)

Ce dossier est servi par nginx sous `/avatars/` et **ignoré par git** (hors ce README) :
les images peuvent être soumises à des droits (personnages, designs protégés) et restent
sur le poste.

L'avatar « Photo » de l'interface lit `photo.json` :

| Clé         | Rôle                                                      |
| ----------- | --------------------------------------------------------- |
| `image`     | fichier image dans ce dossier                             |
| `view`      | zone affichée `[x1, y1, x2, y2]` (pixels de l'image)      |
| `eyes`      | centres des yeux `[[x, y], …]` (halos lumineux)           |
| `eyeRadius` | rayon d'un œil (pixels)                                   |
| `jaw`       | contour de la mâchoire mobile (dents du bas et menton)    |
| `mouthTop`  | ligne de séparation des dents (haut de la bouche ouverte) |
| `jawTravel` | descente maximale de la mâchoire (pixels)                 |

Sans `photo.json`, l'option « Photo » n'apparaît pas dans les Réglages.
