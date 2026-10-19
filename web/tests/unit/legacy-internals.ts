// Fonctions internes de l'ancienne interface (non exportées par app.js et rehearsal.js) :
// leur source est extraite telle quelle du fichier, puis évaluée avec les constantes
// dont elle dépend. Sert de référence aux tables de caractérisation.
import { readFileSync } from "node:fs";

const FRONTEND = new URL("../../../frontend/", import.meta.url);

function read(file: string): string {
  return readFileSync(new URL(file, FRONTEND), "utf8");
}

// Extraction fragile si le legacy est réindenté : un repère absent est une erreur
function found(index: number, what: string): number {
  if (index < 0) throw new Error(`legacy : fin de ${what} introuvable`);
  return index;
}

// Déclaration de premier niveau : `function nom(` jusqu'à la `}` en colonne 0, ou
// `const NOM =` jusqu'au premier `;` en fin de ligne
function declaration(text: string, name: string): string {
  const fn = text.indexOf(`\nfunction ${name}(`);
  if (fn >= 0)
    return text.slice(fn, found(text.indexOf("\n}\n", fn), name) + 3);
  const constant = text.indexOf(`\nconst ${name} =`);
  if (constant >= 0)
    return text.slice(constant, found(text.indexOf(";\n", constant), name) + 2);
  throw new Error(`${name} introuvable`);
}

function load<T>(file: string, names: string[], params: string[] = []) {
  const text = read(file);
  const body = names.map((name) => declaration(text, name)).join("\n");
  const exported = names.filter((name) => /^[a-z]/.test(name));
  return new Function(
    ...params,
    `${body}\nreturn { ${exported.join(", ")} };`,
  ) as (...args: unknown[]) => T;
}

export type Message = { role: string; content: string };

export const legacyApp = {
  base64FromPcm: load<{ base64FromPcm(buffer: ArrayBuffer): string }>(
    "app.js",
    ["base64FromPcm"],
  )().base64FromPcm,
  floatFromBase64Pcm: load<{ floatFromBase64Pcm(b64: string): Float32Array }>(
    "app.js",
    ["floatFromBase64Pcm"],
  )().floatFromBase64Pcm,
  recentHistory(conversation: Message[]): Message[] {
    return load<{ recentHistory(): Message[] }>(
      "app.js",
      ["HISTORY_LIMIT", "HISTORY_CHARS", "recentHistory"],
      ["conversation"],
    )(conversation).recentHistory();
  },
};

type Report = { revisions?: { criterion: string; before: number }[] };

export const legacyRehearsal = load<{
  clock(seconds: number): string;
  longClock(seconds: number): string;
  initialScores(report: Report): Record<string, number>;
  newPart(previous: string, text: string): string;
}>("rehearsal.js", [
  "clock",
  "longClock",
  "initialScores",
  "OPENING_WORDS",
  "plainWord",
  "tokens",
  "newPart",
])();

// Lecture du flux SSE de writtenReply (app.js), extraite de la boucle de lecture ; le
// rendu au fil de l'eau est neutralisé. Renvoie le texte cumulé ou lève comme l'original.
const SSE_START = "    const reader = response.body.getReader();";
const SSE_END = '\n    const line = subtitleLine(itemId, "assistant");';

export function legacySse(chunks: Uint8Array[]): Promise<string> {
  const text = read("app.js");
  const start = found(text.indexOf(SSE_START), "la boucle SSE");
  const loop = text.slice(
    start,
    found(text.indexOf(SSE_END, start), "la boucle SSE"),
  );
  const read_ = new Function(
    "response",
    "subtitleLine",
    "renderInto",
    "ui",
    "itemId",
    `return (async () => { let answer = "";\n${loop}\nreturn answer; })();`,
  );
  let index = 0;
  const response = {
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true, value: undefined },
      }),
    },
  };
  const line = { classList: { add() {} }, querySelector: () => ({}) };
  return read_(
    response,
    () => line,
    () => {},
    { subtitles: {} },
    "msg_test",
  );
}
