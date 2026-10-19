// Demi-duplex, écrit pendant l'appel, SSE coupé, pièces jointes et indicateur réseau
// (grille AP-4, EC-3, EC-4, PJ-1, RS-1, RS-2) en mock.
import type { Page } from "@playwright/test";

import { MockApi } from "../support/mock-api";
import { expect, test } from "../support/test";
import { RealtimeMock, SILENT_DELTA } from "../support/ws-scenario";

function sse(chunks: string[], done = true): string {
  return (
    chunks
      .map(
        (content) =>
          `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
      )
      .join("") + (done ? "data: [DONE]\n\n" : "")
  );
}

function count(realtime: RealtimeMock, type: string): number {
  return realtime.received.filter((event) => event.type === type).length;
}

// Réponse en cours, environ 2 s d'audio en file
function startLongReply(realtime: RealtimeMock) {
  realtime.send({ type: "input_audio_buffer.speech_stopped", item_id: "u1" });
  realtime.send({ type: "response.created", response: { id: "r1" } });
  realtime.send({
    type: "response.output_audio_transcript.delta",
    item_id: "a1",
    delta: "Une longue réponse",
  });
  for (let i = 0; i < 100; i += 1) {
    realtime.send({
      type: "response.output_audio.delta",
      item_id: "a1",
      delta: SILENT_DELTA,
    });
  }
}

test.describe("appel, demi-duplex et écrit pendant l'appel @mock @appel @lot3", () => {
  test.beforeEach(async ({ page }) => {
    await new MockApi(page).install();
  });

  test("AP-4 : demi-duplex, micro tenu pendant la lecture puis rouvert", async ({
    page,
    ui,
  }) => {
    const realtime = await new RealtimeMock(page).install();
    await ui.goto();
    await ui.halfDuplex().check();
    await ui.startCall();
    await realtime.connectedSocket();
    await expect
      .poll(() => count(realtime, "input_audio_buffer.append"))
      .toBeGreaterThan(5);

    startLongReply(realtime);
    await expect.poll(() => ui.callState()).toBe("speaking");
    // Trames déjà parties avant la bascule : on laisse passer la file
    await page.waitForTimeout(150);
    const held = count(realtime, "input_audio_buffer.append");
    await page.waitForTimeout(600);
    expect(count(realtime, "input_audio_buffer.append")).toBe(held);

    realtime.send({
      type: "response.done",
      response: { id: "r1", status: "completed" },
    });
    await expect
      .poll(() => ui.callState(), { timeout: 15_000 })
      .toBe("listening");
    await expect
      .poll(() => count(realtime, "input_audio_buffer.append"))
      .toBeGreaterThan(held + 5);
    await ui.hangUp();
  });

  test("AP-4b : sans demi-duplex, le micro reste ouvert pendant la lecture", async ({
    page,
    ui,
  }) => {
    const realtime = await new RealtimeMock(page).install();
    await ui.goto();
    await expect(ui.halfDuplex()).not.toBeChecked();
    await ui.startCall();
    await realtime.connectedSocket();
    startLongReply(realtime);
    await expect.poll(() => ui.callState()).toBe("speaking");
    const before = count(realtime, "input_audio_buffer.append");
    await expect
      .poll(() => count(realtime, "input_audio_buffer.append"))
      .toBeGreaterThan(before + 5);
    expect(await ui.callState()).toBe("speaking");
    await ui.hangUp();
  });

  test("EC-4 : écrit pendant une réponse, relancé après response.done", async ({
    page,
    ui,
  }) => {
    const realtime = await new RealtimeMock(page).install();
    await ui.goto();
    await ui.startCall();
    await realtime.connectedSocket();
    await expect.poll(() => ui.callState()).toBe("listening");
    startLongReply(realtime);
    await expect.poll(() => ui.callState()).toBe("speaking");

    await ui.sendText("Et Lyon ?");
    await expect
      .poll(() =>
        realtime.received.some(
          (event) =>
            event.type === "conversation.item.create" &&
            JSON.stringify(event.item).includes("Et Lyon ?"),
        ),
      )
      .toBe(true);
    await expect(ui.subtitles()).toContainText("Et Lyon ?");
    // Réponse en cours : la relance attend la fin
    expect(count(realtime, "response.create")).toBe(0);

    realtime.send({
      type: "response.done",
      response: { id: "r1", status: "completed" },
    });
    await expect.poll(() => count(realtime, "response.create")).toBe(1);
    await expect.poll(() => ui.callState()).toBe("thinking");
    await ui.hangUp();
  });

  test("EC-4b : écrit hors réponse, relancé tout de suite", async ({
    page,
    ui,
  }) => {
    const realtime = await new RealtimeMock(page).install();
    await ui.goto();
    await ui.startCall();
    await realtime.connectedSocket();
    await expect.poll(() => ui.callState()).toBe("listening");
    await ui.sendText("Bonjour");
    await expect.poll(() => count(realtime, "response.create")).toBe(1);
    await expect.poll(() => ui.callState()).toBe("thinking");
    await ui.hangUp();
  });

  test("EC-4c : ajout au contexte pendant l'appel, sans relance", async ({
    page,
    ui,
  }) => {
    const realtime = await new RealtimeMock(page).install();
    await ui.goto();
    await ui.startCall();
    await realtime.connectedSocket();
    await expect.poll(() => ui.callState()).toBe("listening");
    await ui.addToContext("Je travaille sur nginx.");
    await expect
      .poll(() =>
        realtime.received.some(
          (event) =>
            event.type === "conversation.item.create" &&
            JSON.stringify(event.item).includes("Je travaille sur nginx."),
        ),
      )
      .toBe(true);
    await expect(ui.subtitles()).toContainText("écrit · ajouté au contexte");
    await page.waitForTimeout(300);
    expect(count(realtime, "response.create")).toBe(0);
    expect(await ui.callState()).toBe("listening");
    await ui.hangUp();
  });
});

test.describe("réponse écrite coupée @mock @ecrit @lot3", () => {
  test.use({ allowConsoleErrors: ["Failed to load resource"] });

  test("EC-3 : flux SSE interrompu, texte partiel gardé et saisie réactivée", async ({
    page,
    ui,
  }) => {
    // Le flux transmet le début de la réponse puis la connexion tombe
    await page.addInitScript(() => {
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const response = await original(input, init);
        const url = typeof input === "string" ? input : String(input);
        if (!url.includes("api/chat") || !response.body) return response;
        const reader = response.body.getReader();
        const broken = new ReadableStream({
          async start(controller) {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
            controller.error(new TypeError("network error"));
          },
        });
        return new Response(broken, {
          status: response.status,
          headers: response.headers,
        });
      };
    });
    const api = await new MockApi(page)
      .on(/^POST \/api\/chat$/, (route) =>
        route.fulfill({
          contentType: "text/event-stream",
          body: sse(["Paris est ", "la capi"], false),
        }),
      )
      .install();
    await ui.goto();
    await ui.sendText("Quelle est la capitale de la France ?");
    const line = ui.lastAssistantLine();
    await expect(line).toContainText("Paris est la capi");
    await expect(line).toContainText(
      "réponse impossible : le serveur est injoignable",
    );
    expect(await ui.callState()).toBe("idle");

    await ui.sendText("Reprends");
    await expect
      .poll(() => api.calls.filter((call) => call.path === "/api/chat").length)
      .toBe(2);
  });
});

test.describe("pièces jointes @mock @ecrit @lot3", () => {
  function documentFor(name: string, voice = true) {
    return {
      id: `doc-${name.replace(/\W/g, "")}`,
      name,
      kind: "texte",
      tokens: voice ? 120 : 42_000,
      voice,
    };
  }

  async function mockUploads(page: Page) {
    return new MockApi(page)
      .on(/^POST \/api\/documents$/, (route) => {
        const name = decodeURIComponent(
          route.request().headers()["x-filename"] ?? "",
        );
        if (name.startsWith("gros"))
          return route.fulfill({ status: 413, json: {} });
        return route.fulfill({
          json: documentFor(name, !name.startsWith("long")),
        });
      })
      .install();
  }

  const file = (name: string) => ({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(`contenu de ${name}`),
  });

  test("PJ-1 : ajout, retrait, tout retirer", async ({ page, ui }) => {
    const api = await mockUploads(page);
    await ui.goto();
    await expect(ui.attachments()).toHaveCount(0);

    await ui.attachInput().setInputFiles([file("notes.txt"), file("long.txt")]);
    await expect(ui.attachments()).toHaveCount(2);
    await expect(ui.subtitles()).toContainText("Document joint : notes.txt");
    await expect(ui.subtitles()).toContainText(
      "Document joint : long.txt — trop long pour l'oral, utilisé à l'écrit",
    );
    await expect(ui.attachments().nth(1)).toContainText("écrit seulement");
    const posts = api
      .writes()
      .filter(
        (call) => call.method === "POST" && call.path === "/api/documents",
      );
    expect(posts.map((call) => call.body)).toEqual([
      "contenu de notes.txt",
      "contenu de long.txt",
    ]);

    await page.getByRole("button", { name: "Retirer notes.txt" }).click();
    await expect(ui.attachments()).toHaveCount(1);
    expect(
      api
        .writes()
        .some(
          (call) =>
            call.method === "DELETE" &&
            call.path === "/api/documents/doc-notestxt",
        ),
    ).toBe(true);

    await page.getByRole("button", { name: "Nouvelle conversation" }).click();
    await expect(ui.attachments()).toHaveCount(0);
    await expect
      .poll(() =>
        api
          .writes()
          .some(
            (call) =>
              call.method === "DELETE" && call.path === "/api/documents",
          ),
      )
      .toBe(true);
  });

  test("PJ-1b : documents déjà joints repris au chargement", async ({
    page,
    ui,
  }) => {
    const api = new MockApi(page);
    api.set("documents", [documentFor("rapport.txt")]);
    await api.install();
    await ui.goto();
    await expect(ui.attachments()).toHaveCount(1);
    await expect(ui.attachments().first()).toContainText("rapport.txt");
  });

  test.describe("refus", () => {
    test.use({ allowConsoleErrors: ["Failed to load resource"] });
    test("PJ-1c : fichier trop volumineux, erreur dans la conversation", async ({
      page,
      ui,
    }) => {
      await mockUploads(page);
      await ui.goto();
      await ui.attachInput().setInputFiles([file("gros.txt")]);
      await expect(ui.subtitles()).toContainText(
        "gros.txt : fichier trop volumineux (15 Mo au maximum)",
      );
      await expect(ui.attachments()).toHaveCount(0);
    });
  });
});

test.describe("indicateur réseau @mock @reseau @lot3", () => {
  const ONLINE = {
    online: true,
    search: true,
    checked: 1792369904.3,
    searching: false,
    sharing: false,
  };

  test("RS-1 : libellés, titre et lignes système aux transitions", async ({
    page,
    ui,
  }) => {
    await page.clock.install();
    const api = await new MockApi(page).install();
    api.set("net", ONLINE);
    await ui.goto();
    const indicator = ui.netIndicator();
    await expect(indicator).toHaveText("Internet");
    await expect(indicator).toHaveAttribute(
      "title",
      "Connecté à Internet : recherche web disponible, modèles Claude disponibles",
    );

    api.set("net", { ...ONLINE, online: false, search: false });
    await page.clock.runFor(15_000);
    await expect(indicator).toHaveText("Hors ligne");
    await expect(indicator).toHaveAttribute(
      "title",
      "Pas de connexion à Internet : pas de recherche web, modèles locaux seulement",
    );
    await expect(ui.subtitles()).toContainText(
      "Connexion Internet perdue : pas de recherche web, modèles locaux seulement.",
    );

    api.set("net", { ...ONLINE, search: false });
    await page.clock.runFor(15_000);
    await expect(indicator).toHaveText("Internet");
    await expect(indicator).toHaveAttribute(
      "title",
      /recherche web indisponible \(SearXNG ne répond pas\)/,
    );
    await expect(ui.subtitles()).toContainText(
      "Connexion Internet rétablie : recherche web et modèles Claude disponibles.",
    );
  });

  test("RS-1b : pas de ligne système au premier relevé", async ({
    page,
    ui,
  }) => {
    const api = new MockApi(page);
    api.set("net", { ...ONLINE, online: false });
    await api.install();
    await ui.goto();
    await expect(ui.netIndicator()).toHaveText("Hors ligne");
    await expect(ui.subtitles()).not.toContainText("Connexion Internet");
  });

  test("RS-2 : partage ngrok, libellé, titre et lignes système", async ({
    page,
    ui,
  }) => {
    await page.clock.install();
    const api = await new MockApi(page).install();
    api.set("net", ONLINE);
    await ui.goto();
    const indicator = ui.netIndicator();
    await expect(indicator).toHaveText("Internet");

    api.set("net", { ...ONLINE, sharing: true });
    await page.clock.runFor(15_000);
    await expect(indicator).toHaveText("Internet · partagé");
    await expect(indicator).toHaveAttribute(
      "title",
      /Partage ngrok en cours : Claude et l'écriture dans le RAG sont désactivés$/,
    );
    await expect(ui.subtitles()).toContainText(
      "Partage ngrok ouvert : Claude et l'écriture dans le RAG sont désactivés.",
    );

    api.set("net", ONLINE);
    await page.clock.runFor(15_000);
    await expect(indicator).toHaveText("Internet");
    await expect(ui.subtitles()).toContainText("Partage ngrok fermé.");
  });
});
