// Dernier tour préparé par le routeur : agent, projets du RAG, code dicté, recherche web
import type { Turn } from "@/types/api";

// `since` : époque en ms ; un tour plus ancien appartient à une réponse précédente
export async function lastTurn(since: number): Promise<Turn | null> {
  const response = await fetch("api/turn/last", { cache: "no-store" });
  const turn = (await response.json()) as Turn;
  return turn.at * 1000 < since ? null : turn;
}

export function fencedCode(blocks: NonNullable<Turn["code"]>): string {
  const code = blocks.filter((block) => block.lang !== "tags");
  const tags = blocks.filter((block) => block.lang === "tags");
  return [...code, ...tags]
    .map((block) => `\`\`\`${block.lang}\n${block.code}\n\`\`\``)
    .join("\n\n");
}
