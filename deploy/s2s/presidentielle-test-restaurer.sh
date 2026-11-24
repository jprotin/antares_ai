#!/usr/bin/env bash
# Test sur l'hôte de « presidentielle.sh restaurer » (l'image n'a pas git) : dépôt de
# données temporaire (copie du jeu fictif), deux versions publiées par l'outil,
# restauration de la première, comparaison ; une révision inconnue laisse la fiche
# intacte ; chaque version a sa copie figée dans historique/ (vue « Évolution »). Conteneur jetable sans réseau (PRESIDENTIELLE_ISOLE=1) : aucun service touché.
#
#   ./presidentielle-test-restaurer.sh
set -euo pipefail

cd "$(dirname "$0")"
readonly FICHE=candidats/aline-fictiva.yaml
readonly IMAGE=antares/s2s:1.0.0

echec() {
  printf '\033[1;31mÉCHEC :\033[0m %s\n' "$*" >&2
  exit 1
}
etape() { printf '\033[1m- %s\033[0m\n' "$*"; }

depot="$(mktemp -d)"
trap 'rm -rf -- "${depot}"' EXIT
cp -r router/fixtures/presidentielle/demo/. "${depot}/"
printf 'brouillons/\ndocuments/\n' >"${depot}/.gitignore"

git_test() {
  git -C "${depot}" -c user.name=presidentielle-test -c user.email=test@exemple.invalid \
    -c commit.gpgsign=false "$@"
}
outil() { PRESIDENTIELLE_DATA="${depot}" PRESIDENTIELLE_ISOLE=1 ./presidentielle.sh "$@"; }
empreinte() { sha256sum "${depot}/${FICHE}" | cut -d' ' -f1; }
# Fiche relue dans l'image (YAML), sans version ni mise_a_jour : contenu comparable
contenu() {
  docker run --rm --network none -i --entrypoint python "${IMAGE}" -c '
import sys, yaml
fiche = yaml.safe_load(sys.stdin)
for cle in ("version", "mise_a_jour"):
    fiche.pop(cle, None)
print(yaml.safe_dump(fiche, sort_keys=True, allow_unicode=True))'
}

etape "Version 1 : jeu fictif enregistré"
git_test init -q -b main
git_test add -A
git_test commit -q -m "Version 1"
v1="$(git_test show "HEAD:${FICHE}" | contenu)"

etape "Version 2 : brouillon modifié, publié par l'outil"
mkdir -p "${depot}/brouillons"
sed 's/^  texte: Candidate inventée.*/  texte: Description de la version deux./' \
  "${depot}/${FICHE}" >"${depot}/brouillons/aline-fictiva.yaml"
outil publier aline-fictiva >/dev/null
grep -q 'Description de la version deux' "${depot}/${FICHE}" || echec "version 2 non publiée"
grep -q '^version: 2$' "${depot}/${FICHE}" || echec "version 2 attendue"
git_test add -A
git_test commit -q -m "Version 2"

etape "Révision inconnue : refus, fiche intacte"
avant="$(empreinte)"
if outil restaurer aline-fictiva revision-inconnue >/dev/null 2>&1; then
  echec "révision inconnue acceptée"
fi
[[ "$(empreinte)" == "${avant}" ]] || echec "fiche modifiée par une révision inconnue"
if outil restaurer aline-fictiva HEAD~1:inexistant >/dev/null 2>&1; then
  echec "révision invalide acceptée"
fi
[[ "$(empreinte)" == "${avant}" ]] || echec "fiche modifiée par une révision invalide"

etape "Restauration de la version 1"
outil restaurer aline-fictiva HEAD~1 >/dev/null
[[ "$(contenu <"${depot}/${FICHE}")" == "${v1}" ]] || echec "contenu restauré différent de la version 1"
grep -q '^version: 3$' "${depot}/${FICHE}" || echec "version 3 attendue après restauration"
grep -q 'Restauration de la révision' "${depot}/journal.yaml" || echec "ligne de journal absente"
[[ -z "$(find "${depot}/brouillons" -name '.restaurer-*')" ]] || echec "fichier temporaire laissé"

etape "Copies figées de chaque version (vue « Évolution »)"
readonly HISTORIQUE=historique/aline-fictiva
for n in 1 2 3; do
  [[ -f "${depot}/${HISTORIQUE}/v${n}.yaml" ]] || echec "copie figée v${n} absente"
done
[[ "$(contenu <"${depot}/${HISTORIQUE}/v3.yaml")" == "${v1}" ]] || echec "copie v3 différente de la version 1"
cmp -s "${depot}/${HISTORIQUE}/v3.yaml" "${depot}/${FICHE}" || echec "copie v3 différente de la fiche publiée"

etape "Base valide après restauration"
outil verifier >/dev/null || echec "base en erreur après restauration"

printf '\033[1;32mOK\033[0m : restauration testée sur un dépôt git temporaire\n'
