#!/usr/bin/env bash
# Indexe la documentation d'un dossier (dépôt de code, notes…) dans un projet du RAG
# intégré, via l'API d'antares (même chemin que la fenêtre « Projets du RAG intégré »).
#
#   ./rag-index.sh mon-appli ~/dev/mon-appli
#
# Fichiers pris : Markdown, texte, PDF et Word, hors .git, node_modules, vendor et
# dossiers cachés. Le chemin relatif sert de nom (« adr/0001.md », enregistré
# « adr_0001.md ») pour distinguer les homonymes ; réindexer un fichier le remplace.
# Prérequis : RAG intégré choisi dans Connexions (profil rag-integre démarré).
set -euo pipefail

readonly API=http://127.0.0.1:8765/api/rag/projects
readonly PROJECT_RE='^[a-z0-9][a-z0-9_-]{0,63}$'

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() {
  printf '\033[1;31mERREUR :\033[0m %s\n' "$*" >&2
  exit 1
}

(($# == 2)) || die "usage : $0 <projet> <dossier>"
readonly project="$1" folder="$2"
[[ "${project}" =~ ${PROJECT_RE} ]] ||
  die "nom de projet invalide : ${project} (minuscules, chiffres, - et _)"
[[ -d "${folder}" ]] || die "dossier introuvable : ${folder}"
command -v jq >/dev/null || die "jq introuvable"

# Mode intégré vérifié avant d'envoyer quoi que ce soit
curl -fsS "${API}/${project}/documents" >/dev/null 2>&1 ||
  die "RAG intégré indisponible : Connexions → RAG → « RAG intégré à antares »"

indexed=0 failed=0 chunks=0
while IFS= read -r -d '' file; do
  name="${file#"${folder%/}"/}"
  if answer="$(curl -sS --max-time 300 -X POST \
    -H "X-Filename: $(jq -rn --arg n "${name}" '$n|@uri')" \
    --data-binary "@${file}" "${API}/${project}/documents")" &&
    count="$(jq -er '.chunks' <<<"${answer}" 2>/dev/null)"; then
    indexed=$((indexed + 1))
    chunks=$((chunks + count))
    printf '  %-60s %s extrait(s)\n' "${name}" "${count}"
  else
    failed=$((failed + 1))
    printf '  %-60s ÉCHEC %s\n' "${name}" "$(jq -r '.detail // .' <<<"${answer}" 2>/dev/null)"
  fi
done < <(find "${folder}" \
  \( -name .git -o -name node_modules -o -name vendor -o -path '*/.*' \) -prune -o \
  -type f \( -iname '*.md' -o -iname '*.markdown' -o -iname '*.txt' \
  -o -iname '*.pdf' -o -iname '*.docx' \) -print0)

log "${project} : ${indexed} fichier(s) indexé(s), ${chunks} extrait(s), ${failed} échec(s)"
((failed == 0))
