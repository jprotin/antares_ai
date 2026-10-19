// lib/api.ts : messages d'erreur identiques à settings.js et app.js
import { afterEach, describe, expect, test, vi } from "vitest";

import { failureReason, getJson, httpError, sendJson } from "@/lib/api";

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test.each([
    [413, "la conversation est trop longue pour être envoyée"],
    [502, "le routeur LLM ne répond pas"],
    [504, "le modèle a mis trop de temps à répondre"],
    [500, "erreur HTTP 500"],
  ])("test_httpError_%d_message", (status, message) => {
    expect(httpError(status).message).toBe(message);
  });

  test("test_failureReason_typeerror_serveur_injoignable", () => {
    expect(failureReason(new TypeError("Failed to fetch"))).toBe(
      "le serveur est injoignable",
    );
    expect(failureReason(new Error("autre"))).toBe("autre");
  });

  test("test_getJson_detail_texte_repris", async () => {
    vi.stubGlobal("fetch", respond(422, { detail: "modèle inconnu" }));
    await expect(getJson("api/settings")).rejects.toThrow("modèle inconnu");
  });

  test("test_getJson_detail_validation_liste_mise_en_forme", async () => {
    vi.stubGlobal(
      "fetch",
      respond(422, {
        detail: [
          { loc: ["body", "name"], msg: "champ requis" },
          { loc: ["body", "url"], msg: "URL invalide" },
        ],
      }),
    );
    await expect(getJson("api/agents")).rejects.toThrow(
      "name : champ requis ; url : URL invalide",
    );
  });

  test("test_getJson_sans_detail_code_http", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("pas du json", { status: 500 })),
    );
    await expect(getJson("api/models")).rejects.toThrow(
      "api/models : HTTP 500",
    );
  });

  test("test_getJson_sans_cache_et_sendJson_corps_json", async () => {
    const fetch = respond(200, { ok: true });
    vi.stubGlobal("fetch", fetch);
    await getJson("api/net");
    expect(fetch).toHaveBeenLastCalledWith("api/net", { cache: "no-store" });
    await sendJson("api/settings", "PUT", { model: "m" });
    expect(fetch).toHaveBeenLastCalledWith("api/settings", {
      cache: "no-store",
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: '{"model":"m"}',
    });
  });
});
