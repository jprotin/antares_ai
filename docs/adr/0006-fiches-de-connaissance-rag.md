# 0006 — Fiches de connaissance relues, indexées par une API d'écriture du RAG ai-to-boost

- **Status** : accepted
- **Date** : 2026-09-30
- **Auteur(s)** : jprotin
- **Tags** : RAG, qualité des données, sécurité

## Contexte

Le RAG des projets (ADR 0002) est alimenté par ai-to-boost (`ingest.py`, sync des
dépôts). L'utilisateur veut l'enrichir depuis antares : conclusions d'une conversation,
contenu d'un document joint. Contrainte explicite : **ne pas polluer le RAG** avec du
bavardage ou des informations devenues fausses.

Le service `rag` d'ai-to-boost ne faisait que de la recherche. Les embeddings (FastEmbed
nomic 768d, vecteur nommé) ne peuvent pas être reproduits fidèlement hors de ce service.

## Options envisagées

### Option 1 : indexation automatique de chaque conversation

- **Pour** : aucun effort utilisateur.
- **Contre** : pollution garantie (bavardage, hypothèses, erreurs), aucune maîtrise de
  l'obsolescence.

### Option 2 : index propre à antares (Qdrant ou collection séparée, embeddings locaux)

- **Pour** : aucun changement dans ai-to-boost.
- **Contre** : deuxième chaîne d'embeddings à maintenir ; les fiches n'apparaissent pas
  dans les recherches d'ai-to-boost (webui, Claude Code via MCP).

### Option 3 : fiche rédigée par le LLM, relue, indexée par une API d'écriture du service `rag`

- **Pour** : une seule chaîne d'embeddings ; l'humain valide chaque fiche ; les fiches
  sont visibles partout où le RAG l'est.
- **Contre** : modification d'ai-to-boost (API d'écriture protégée par jeton).

## Décision

Nous retenons l'**option 3**.

- Le LLM actif rédige une fiche (faits et décisions durables, JSON strict) ; il peut
  répondre « rien à retenir ». L'utilisateur la corrige puis l'indexe.
- Les fiches font foi côté antares (`/data/knowledge`, un JSON par fiche) ; le service
  `rag` n'en est que l'index (`POST/DELETE /documents`, `doc_id` `antares:<id>`,
  jeton `RAG_WRITE_TOKEN`, écriture refusée si absent).
- **Anti-doublon** : les fiches antares proches du même projet sont proposées au
  remplacement ; une fiche remplacée devient obsolète et est retirée de l'index.
- **Validité** : `valid_until_ts` optionnel ; `/query` exclut les points `status=obsolete`
  ou expirés. Les documents d'`ingest.py` n'ont pas ces champs et restent visibles.

## Conséquences

### Positives

- Le RAG ne reçoit que du contenu relu ; l'obsolescence est traitée à la recherche.
- Une fiche indexée sert aussi à la webui et à Claude Code (MCP qdrant).

### Négatives / Coûts

- Dépendance à une évolution d'ai-to-boost (branche `feature/rag-indexation`).
- Un jeton d'écriture de plus, recopié par `install.sh`.

### Neutres / À surveiller

- Le filtre d'expiration ne s'applique qu'au service `rag` ; le serveur MCP qdrant
  d'ai-to-boost voit encore les fiches expirées (non les obsolètes, retirées de l'index).
- Qualité des brouillons avec le modèle local : la relecture reste obligatoire.

## Alternatives non explorées (et pourquoi)

- **Écriture directe dans Qdrant depuis antares** : contourne le seul composant qui
  garantit la compatibilité des vecteurs.

## Références

- ADR 0002 (RAG des projets ai-to-boost), ADR 0005 (documents joints)
- ai-to-boost : `services/rag/server.py`, `docs/runbooks/phase5-rag.md`
