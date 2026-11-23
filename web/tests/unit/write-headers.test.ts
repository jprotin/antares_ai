// En-tête X-Antares sur toute écriture vers /api/ (audit de sécurité 2026-11, point 3 ;
// exigé par deploy/s2s/router/write_guard.py) : helpers de lib/api.ts, fetch directs
// appelables sans interface, puis inventaire des fetch d'écriture du code source.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  clearDocuments,
  removeDocument,
} from "@/features/attachments/attachments";
import { loadIdeaPrompt, sendVote } from "@/features/veille/api";
import { deleteResource, getJson, sendJson, WRITE_HEADERS } from "@/lib/api";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

function stubFetch(status = 200, body: unknown = {}) {
  const fetch = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(status === 204 ? null : JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function header(init: RequestInit | undefined, name: string) {
  return new Headers(init?.headers).get(name);
}

describe("en-tête X-Antares", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("test_WRITE_HEADERS_valeur", () => {
    expect(WRITE_HEADERS).toEqual({ "X-Antares": "1" });
  });

  test.each(["POST", "PUT", "PATCH", "DELETE"] as const)(
    "test_sendJson_%s_ajoute_l_en_tete",
    async (method) => {
      const fetch = stubFetch(200, { ok: true });
      await sendJson("api/settings", method, { model: "m" });
      const init = fetch.mock.calls[0]?.[1];
      expect(header(init, "X-Antares")).toBe("1");
      expect(header(init, "Content-Type")).toBe("application/json");
    },
  );

  test("test_deleteResource_ajoute_l_en_tete", async () => {
    const fetch = stubFetch(204);
    await deleteResource("api/agents/a");
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.method).toBe("DELETE");
    expect(header(init, "X-Antares")).toBe("1");
  });

  test("test_getJson_lecture_sans_en_tete", async () => {
    const fetch = stubFetch(200, []);
    await getJson("api/models");
    expect(header(fetch.mock.calls[0]?.[1], "X-Antares")).toBeNull();
  });

  test("test_documents_joints_suppression_avec_en_tete", async () => {
    const fetch = stubFetch(204);
    await removeDocument("doc-1");
    await clearDocuments();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "api/documents/doc-1",
      "api/documents",
    ]);
    for (const [, init] of fetch.mock.calls) {
      expect(init?.method).toBe("DELETE");
      expect(header(init, "X-Antares")).toBe("1");
    }
  });

  test("test_veille_ecriture_avec_en_tete_lecture_sans", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "GET"
        ? new Response("{}", { status: 404 })
        : new Response(
            JSON.stringify({ prompt: "# Contexte", value: "like" }),
            {
              status: 200,
            },
          ),
    );
    vi.stubGlobal("fetch", fetch);
    await sendVote("article", "a", "like");
    await loadIdeaPrompt("a", true);
    expect(
      fetch.mock.calls.map(([, init]) => [
        init?.method,
        header(init, "X-Antares"),
      ]),
    ).toEqual([
      ["POST", "1"],
      ["GET", null],
      ["POST", "1"],
    ]);
  });
});

// Fetch d'écriture directs (corps brut, flux SSE, composants) : chaque appel à fetch dont
// les options déclarent une méthode d'écriture porte WRITE_HEADERS
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

// Texte de l'appel fetch( … ) jusqu'à la parenthèse fermante correspondante
function fetchCalls(code: string): string[] {
  const calls: string[] = [];
  for (let start = code.indexOf("fetch("); start >= 0;) {
    let depth = 0;
    let end = start + "fetch".length;
    for (; end < code.length; end += 1) {
      if (code[end] === "(") depth += 1;
      else if (code[end] === ")" && (depth -= 1) === 0) break;
    }
    calls.push(code.slice(start, end + 1));
    start = code.indexOf("fetch(", end);
  }
  return calls;
}

describe("inventaire des fetch d'écriture", () => {
  const calls = sources(SRC).flatMap((path) =>
    fetchCalls(readFileSync(path, "utf8")).map((call) => ({
      file: path.slice(SRC.length),
      call,
    })),
  );
  const writes = calls.filter(({ call }) => /method\b/.test(call));

  test("test_inventaire_trouve_les_appels_connus", () => {
    const files = new Set(writes.map(({ file }) => file));
    for (const file of [
      "lib/api.ts",
      "engines/realtime/CallEngine.ts",
      "features/attachments/attachments.ts",
      "features/rag-projects/RagProjectsDialog.tsx",
      "features/rehearsal/controller.ts",
      "features/veille/api.ts",
    ])
      expect(files).toContain(file);
  });

  test("test_chaque_fetch_d_ecriture_porte_WRITE_HEADERS", () => {
    const missing = writes
      .filter(({ call }) => !call.includes("WRITE_HEADERS"))
      .map(({ file, call }) => `${file} : ${call.split("\n")[0]}`);
    expect(missing).toEqual([]);
  });
});
