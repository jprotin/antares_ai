# Interface antares (Vite + React + shadcn/ui)

Nouvelle interface en cours de migration depuis `frontend/` (ADR 0012). Fichiers
statiques servis par nginx, avec la CSP actuelle (`script-src 'self'`, `style-src 'self'`).

## Commandes

```bash
npm ci --ignore-scripts
npm run dev     # http://127.0.0.1:5173, appels relayés vers la pile (ANTARES_URL, défaut 127.0.0.1:8765)
npm run build
# Sous le vrai nginx, sur 127.0.0.1:8766, sans toucher aux autres services :
docker compose -f ../deploy/s2s/compose.yaml -f ../deploy/s2s/compose.web-next.yaml up -d --no-deps --build web-next
```

## Règles CSS

| Cas                                                                                     | Traitement                                                                                 |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Mise en page et habillage simples                                                       | Utilitaires Tailwind dans le JSX, jetons shadcn                                            |
| CSS propre à une fonctionnalité (orbe, états de l'appel, rapport, animations, `:has()`) | `*.module.css` dans le répertoire de la fonctionnalité, enveloppé dans `@layer components` |
| Règles globales (jetons de thème, `@property --hue`, `body`)                            | `src/index.css`, dans `@layer base` ou les jetons                                          |

Aucun CSS hors `@layer` : dans Tailwind v4, il l'emporterait sur tous les utilitaires.
L'accent vif d'antares s'appelle `--brand` (`--accent` est un fond de survol chez shadcn).

## CSP

- Jamais de `<style>` injecté ni d'attribut `style` posé par `setAttribute` : la prop
  React `style={{…}}` et `el.style.setProperty` (CSSOM) sont autorisées.
- `react-remove-scroll-bar` est remplacé par `src/shims/remove-scroll-bar/` (alias dans
  `vite.config.ts`).
- Composants shadcn exclus (injectent des styles ou non retenus) : `select`,
  `alert-dialog`, `sonner`, `toast`, `scroll-area`, `drawer`, `sheet`, `chart`.
  Menus déroulants : `ui/native-select.tsx` ; confirmations : `window.confirm`.
- Popover en mode non modal uniquement.
- `src/styles/shadcn.css` est une copie du CSS de `shadcn@4.22.1` (MIT), pour ne pas
  embarquer le CLI comme dépendance. Une seule retouche : la règle `.shimmer` placée dans
  `@layer utilities` (à refaire si le fichier est régénéré).

## Qualité

- `npm run lint` : règles CSP (pas d'injection de HTML hors `MarkdownView.tsx`, pas d'attribut
  `style` par `setAttribute`) et frontières (moteurs sans React, une fonctionnalité n'en
  importe une autre que par son `index.ts`).
- `npm run build` : contrôle de `dist/` (`scripts/check-dist.mjs` : ni script ni style en ligne,
  pas d'URL `data:`, URL absolues listées dans `scripts/url-allowlist.txt`), inventaire des
  licences et `version.json`.
- Hooks pre-commit `web-*` : prérequis `npm --prefix web ci --ignore-scripts`.
