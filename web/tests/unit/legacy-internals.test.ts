// Fonctions internes de l'appel et de la Répétition : mêmes résultats que l'ancienne
// interface (vecteurs dorés relevés sur ses sources : fixtures/legacy-internals.json).
// La nouvelle implémentation rejoindra `cases` aux lots 3 et 6.
import { describe, expect, test } from "vitest";

import golden from "./fixtures/legacy-internals.json";
import sseCases from "./fixtures/sse-cases.json";
import {
  legacyApp,
  legacyRehearsal,
  legacySse,
  type Message,
} from "./legacy-internals";

import { base64FromPcm, floatFromBase64Pcm } from "@/lib/pcm";
import { readChatStream } from "@/lib/sse";
import {
  clock,
  initialScores,
  longClock,
  newPart,
} from "@/features/rehearsal/rehearsalMachine";
import { recentHistory } from "@/state/slices/conversation";

const nextRehearsal = {
  clock,
  longClock,
  newPart,
  initialScores: (report: never) => initialScores(report),
};

const nextApp = {
  base64FromPcm,
  floatFromBase64Pcm,
  recentHistory: (messages: Message[]) => recentHistory(messages),
};

// Même lecteur que legacySse : morceaux servis un à un
function nextSse(chunks: Uint8Array[]): Promise<string> {
  let index = 0;
  return readChatStream({
    read: async () =>
      index < chunks.length
        ? { done: false, value: chunks[index++] }
        : { done: true },
  });
}

type Pcm = { samples: number[]; floats: number[] };
type History = { role: string; length: number; char: string }[];

const cases = [
  {
    name: "legacy",
    app: legacyApp,
    rehearsal: legacyRehearsal,
    sse: legacySse,
  },
  { name: "next", app: nextApp, rehearsal: nextRehearsal, sse: nextSse },
];

type SseCase = {
  chunks: (string | number[])[];
  answer?: string;
  error?: string;
};
const encoder = new TextEncoder();

function conversation(history: History): Message[] {
  return history.map(({ role, length, char }) => ({
    role,
    content: char.repeat(length),
  }));
}

describe.each(cases)("caractérisation ($name)", ({ app, rehearsal, sse }) => {
  const { gros, ...small } = golden.pcm;

  // Base64 vérifié par décodage (des chaînes base64 figées passeraient pour des secrets)
  test.each(Object.entries(small as Record<string, Pcm>))(
    "test_pcm_%s_aller_retour",
    (_, { samples, floats }) => {
      const pcm = new Int16Array(samples);
      const base64 = app.base64FromPcm(pcm.buffer);
      expect(Buffer.from(base64, "base64")).toEqual(Buffer.from(pcm.buffer));
      expect(Array.from(app.floatFromBase64Pcm(base64))).toEqual(floats);
    },
  );

  test("test_pcm_tampon_au_dela_de_0x8000_octets", () => {
    const samples = new Int16Array(gros.length).map(
      (_, i) => ((i * 31) % 65536) - 32768,
    );
    const base64 = app.base64FromPcm(samples.buffer);
    expect(base64).toHaveLength(gros.base64Length);
    expect(Buffer.from(base64, "base64")).toEqual(Buffer.from(samples.buffer));
  });

  test.each(Object.keys(golden.histories))("test_recentHistory_%s", (name) => {
    const messages = conversation(
      golden.histories[name as keyof typeof golden.histories],
    );
    const kept = app.recentHistory(messages);
    const expected = golden.recent[name as keyof typeof golden.recent];
    expect(kept).toHaveLength(expected.kept);
    expect(kept[0] ? messages.indexOf(kept[0]) : null).toBe(expected.first);
    expect(kept.reduce((sum, m) => sum + m.content.length, 0)).toBe(
      expected.chars,
    );
  });

  test.each(golden.clocks as [number, string, string][])(
    "test_clock_%s_s",
    (seconds, short, long) => {
      expect(rehearsal.clock(seconds)).toBe(short);
      expect(rehearsal.longClock(seconds)).toBe(long);
    },
  );

  test.each(
    golden.scoreCases.map(([report, scores], index) => ({
      index,
      report,
      scores,
    })),
  )("test_initialScores_cas_$index", ({ report, scores }) => {
    expect(rehearsal.initialScores(report as never)).toEqual(scores);
  });

  // Particularité conservée : la ponctuation qui suit la reprise reste en tête (« , je… »)
  test.each(golden.parts as [string, string, string][])(
    "test_newPart_%j_puis_%j",
    (previous, text, part) => {
      expect(rehearsal.newPart(previous, text)).toBe(part);
    },
  );

  // Particularités conservées : dernier fragment sans saut de ligne perdu, JSON invalide fatal
  test.each(Object.entries(sseCases as Record<string, SseCase>))(
    "test_sse_%s",
    async (_, { chunks, answer, error }) => {
      const bytes = chunks.map((chunk) =>
        typeof chunk === "string"
          ? encoder.encode(chunk)
          : new Uint8Array(chunk),
      );
      if (error) await expect(sse(bytes)).rejects.toThrow(SyntaxError);
      else await expect(sse(bytes)).resolves.toBe(answer);
    },
  );
});
