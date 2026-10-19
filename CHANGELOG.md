# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

## [Non publié]

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
