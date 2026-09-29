# 0005 — Documents joints : lecture intégrale, contexte long à l'écrit, refus au-delà

- **Status** : accepted
- **Date** : 2026-09-29
- **Auteur(s)** : jprotin
- **Tags** : LLM, documents, fiabilité

## Contexte

L'utilisateur veut joindre des documents (PDF, Word, texte, images) pour les faire
analyser, à l'écrit comme pendant un appel. ai-to-boost a déjà mesuré (son ADR 0009)
qu'**Ollama tronque le début d'un prompt trop long sans erreur**, et que le modèle
répond alors avec aplomb sur un document qu'il n'a vu qu'en partie ; reproduit ici : un
document de 440 000 caractères a été coupé à 32 771 tokens, et le modèle a déclaré ne pas
trouver l'information.

Différence avec ai-to-boost : le GPU de 12 Go est partagé avec le moteur vocal (~5 Go).
Mesuré avec le moteur chargé : un contexte de 65 536 tokens tient à 100 % sur le GPU
(11,5 Go utilisés) ; un document de 48 800 tokens est lu en entier (repères début /
milieu / fin retrouvés) en 17,6 s.

## Options envisagées

### Option 1 : lecture intégrale dans la consigne, avec limites explicites

- **Pour** : le modèle voit tout le document ; pas d'indexation ; les questions de suivi
  fonctionnent (document renvoyé à chaque tour).
- **Contre** : taille limitée par le contexte ; latence proportionnelle à la taille.

### Option 2 : RAG sur le document (découpage, recherche d'extraits)

- **Pour** : pas de limite de taille.
- **Contre** : ne voit que des extraits (résumés et vues d'ensemble impossibles) ; plus
  lent que la lecture intégrale d'après ai-to-boost (88 s contre 49 s).

### Option 3 : laisser Ollama gérer (troncature)

- **Contre** : réponses fausses mais plausibles, sans avertissement. Écartée.

## Décision

Nous retenons l'**option 1** (`deploy/s2s/router/documents.py`) :

- extraction à l'envoi (`pdftotext` ajouté à l'image, Word lu par `zipfile`, texte
  décodé, images gardées en base64 pour la vision de gemma4) ;
- documents placés **en tête** de la consigne système (préfixe stable pour le cache
  d'Ollama), renvoyés à chaque tour, jusqu'à « Nouvelle conversation » ;
- limites : **voix** 20 000 tokens (contexte par défaut, 32 768) ; **écrit** 56 000
  tokens, en basculant sur l'API native d'Ollama avec `num_ctx` 65 536 au-delà de 20 000
  (l'API `/v1` ne transmet pas `num_ctx`) ;
- **refus explicite** à l'envoi au-delà de 56 000 tokens, pour un PDF scanné ou un format
  inconnu ; à l'oral, un document trop long est écarté et le modèle propose de poser la
  question à l'écrit ; image avec Claude écartée (bridge texte seulement), signalée.

## Conséquences

### Positives

- Pas de réponse sur un document tronqué : chaque limite est visible (étiquette « écrit
  seulement », refus, mention « non lu » sous la réponse).
- Analyse multi-documents avec citation des sources (vérifié : PDF, Word, Markdown).

### Négatives / Coûts

- Au-delà de 20 000 tokens, le modèle est rechargé avec un contexte de 65 536 (quelques
  secondes), puis de nouveau au contexte par défaut à la reprise de la voix.
- PDF scannés non pris en charge (pas de reconnaissance de caractères).
- Estimation des tokens approximative (3,5 caractères par token, mesuré 3,9 en
  français) : volontairement prudente.

### Neutres / À surveiller

- Les documents traités pourront alimenter le RAG via des fiches de connaissance relues
  (étape suivante), sans y verser le document brut.

## Références

- `deploy/s2s/router/documents.py`, `frontend/attachments.js`
- ai-to-boost : ADR 0009 (pièces jointes du chat, contexte long)
