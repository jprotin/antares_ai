# Migration de l'interface vers Vite + React + shadcn/ui

Date : 2026-10-19. develop `1bfed82` (poussé). Décision : ADR 0012 (acceptée).

## Ce qui change pour l'utilisateur

Rien de visible : même page sur <http://127.0.0.1:8765>, même rendu (captures comparées à
chaque lot, PDF du rapport de Répétition identique au pixel près), mêmes contrats d'API.
Améliorations au passage :

- plus de flash du thème clair au chargement ;
- Markdown des réponses sans aucune violation CSP, même sur une réponse hostile ;
- un seul contexte WebGL vivant au plus en changeant d'avatar (fuite corrigée) ;
- formulaires refermés masqués, champs validés, erreurs d'API affichées au lieu d'être perdues ;
- page jamais intégrable dans un site tiers (`frame-ancestors 'none'`, `X-Frame-Options DENY`),
  utile pendant un partage ngrok.

## Ce qui change pour le développeur

| Avant (`frontend/`)                                           | Après (`web/`)                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| JS natif sans build, ~10 200 lignes                           | TypeScript strict, Vite, React 19, shadcn/ui (Radix), Tailwind 4          |
| État dans le DOM                                              | Store Zustand unique (`src/state/`)                                       |
| Une fonctionnalité gonfle `app.js`, `style.css`, `index.html` | Un répertoire par fonctionnalité + 2 lignes dans `src/app/features.ts`    |
| Bibliothèques copiées dans `vendor/`                          | `package-lock.json`, image Docker multi-stage épinglée par digest         |
| Pas de tests de l'interface                                   | 278 tests unitaires, ~76 scénarios Playwright, contrôles CSP automatiques |

Points d'entrée : `web/README.md` (architecture, règles CSS et CSP, extension),
`web/tests/PARITY.md` (grille de parité et mesures).

## Exploitation

```bash
cd deploy/s2s
./ui.sh new [--build]   # nouvelle interface (reconstruite si web/ a changé)
./ui.sh legacy          # retour arrière en une commande, sans build ni réseau
```

- Le choix persiste dans `.env` (`COMPOSE_FILE`) ; `docker compose up -d` le garde.
- Après un `git pull` qui touche `web/` : `./ui.sh new` (l'empreinte `HEAD:web` dans
  `version.json` détecte une image périmée).
- `install.sh` construit l'image ; en cas d'échec (registre npm injoignable), message
  explicite et renvoi vers `./ui.sh legacy`.

## Tests

```bash
cd web
npm test                                  # unitaires
ANTARES_UI=next npx playwright test       # suite complète sur 8765
ANTARES_UI=legacy npx playwright test     # même suite sur l'ancienne (oracle)
npm run test:perf                         # latence, série A/A (LATENCY_B pour comparer)
```

Gardes automatiques sur chaque scénario : aucune requête hors origine, aucune violation CSP,
aucune erreur JS, aucune écriture sur la vraie API (seul `PUT /api/settings` attendu).

## Mesures

| Mesure                                      | Ancienne       | Nouvelle                        |
| ------------------------------------------- | -------------- | ------------------------------- |
| Segment client (réponse → lecture), médiane | 0,6 ms         | 0,5 ms                          |
| Bout en bout avec Claude, médiane           | 2 862 ms       | 2 778 ms                        |
| Rendu Markdown 5 000 caractères             | 7,8 à 8,1 ms   | 10,2 à 10,5 ms (exception MD-4) |
| Poids servi brut / gzip                     | 1 221 / 335 Ko | 1 390 / 388 Ko                  |
| Images par seconde (orbe, avatars 3D)       | 60             | 60                              |

## Validation

- Parité : toutes les lignes automatisables vertes ; manuelles faites par l'utilisateur
  (« tout fonctionne »).
- Sécurité : aucune faille critique ; gitleaks, `npm audit` (0) et pre-commit verts.
- Retours arrière : huit cas vérifiés (a à h), dont l'absence de l'image `antares/web`.
- Sauvegardes : `/datadisk/backups/antares_ai-2026-10-19-1247-avant-bascule.tar.gz`
  (restauration d'essai identique).

## Reste à faire

- Vers le 2026-11-02, après deux semaines sans régression : supprimer `frontend/`,
  `compose.legacy-ui.yaml` et le mode `legacy` de `ui.sh` et des tests (sur Go).
- Dès lors, l'oracle de parité disparaît : les tests visent seulement `web/`.

Entrée de CHANGELOG proposée : `changelog-entry.md`.
