// Recherche du sélecteur : sans accents ni casse, sur le libellé, le détail et le
// groupe (comme picker.js) ; signature du filtre de cmdk
function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export const filter = (_value: string, search: string, keywords?: string[]) =>
  normalize((keywords ?? []).join(" ")).includes(normalize(search.trim()))
    ? 1
    : 0;
