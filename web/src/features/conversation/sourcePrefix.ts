// Préfixe des identifiants de sources d'une ligne (ancres des renvois [n])
export function sourcePrefix(lineId: string): string {
  return `src-${lineId}`.replace(/[^\w-]/g, "");
}
