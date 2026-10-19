// Identifiant déduit d'un nom (fournisseurs, serveurs MCP) : minuscules sans accents,
// tirets, 32 caractères au plus (règle du routeur)
export function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}
