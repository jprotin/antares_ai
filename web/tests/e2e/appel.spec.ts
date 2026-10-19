// Appel (grille AP) en mock : WebSocket realtime simulé, micro simulé de Chromium.
import { MockApi } from "../support/mock-api";
import { expect, test } from "../support/test";
import { RealtimeMock } from "../support/ws-scenario";

test.describe("appel @mock @appel @lot3", () => {
  test.beforeEach(async ({ page }) => {
    await new MockApi(page).install();
  });

  test("AP-5 : six états visuels selon les événements serveur", async ({
    page,
    ui,
  }) => {
    const realtime = await new RealtimeMock(page).install();
    await ui.goto();
    expect(await ui.callState()).toBe("idle");
    await ui.startCall();
    await realtime.connectedSocket();
    await expect.poll(() => ui.callState()).toBe("listening");
    await expect(ui.status()).toHaveText("Je vous écoute");

    realtime.send({ type: "input_audio_buffer.speech_started", item_id: "u1" });
    await expect.poll(() => ui.callState()).toBe("user");
    await expect(ui.status()).toHaveText("Vous parlez…");

    realtime.send({ type: "input_audio_buffer.speech_stopped", item_id: "u1" });
    await expect.poll(() => ui.callState()).toBe("thinking");

    realtime.send({ type: "response.created", response: { id: "r1" } });
    await realtime.turn("Paris.", { audioChunks: 3 });
    await expect(ui.lastAssistantLine()).toContainText("Paris.");
    await expect.poll(() => ui.callState()).toBe("listening");

    await ui.hangUp();
    await expect.poll(() => ui.callState()).toBe("idle");
    await expect(ui.status()).toHaveText("Appel terminé");
  });

  test("AP-2 : trames micro de 20 ms (1 280 caractères base64)", async ({
    page,
    ui,
  }) => {
    const realtime = await new RealtimeMock(page).install();
    await ui.goto();
    await ui.startCall();
    await realtime.connectedSocket();
    await expect
      .poll(
        () =>
          realtime.received.filter(
            (e) => e.type === "input_audio_buffer.append",
          ).length,
      )
      .toBeGreaterThan(5);
    const frames = realtime.received.filter(
      (e) => e.type === "input_audio_buffer.append",
    );
    expect(new Set(frames.map((e) => String(e.audio).length))).toEqual(
      new Set([1280]),
    );
    await ui.hangUp();
  });

  test("AP-3 : parler pendant la réponse l'interrompt", async ({
    page,
    ui,
  }) => {
    const realtime = await new RealtimeMock(page).install();
    await ui.goto();
    await ui.startCall();
    await realtime.connectedSocket();
    realtime.send({ type: "input_audio_buffer.speech_stopped", item_id: "u1" });
    realtime.send({ type: "response.created", response: { id: "r1" } });
    realtime.send({
      type: "response.output_audio_transcript.delta",
      item_id: "a1",
      delta: "Une longue réponse",
    });
    // Environ 2 s d'audio en file : la lecture est en cours quand l'utilisateur reprend
    for (let i = 0; i < 100; i += 1) {
      realtime.send({
        type: "response.output_audio.delta",
        item_id: "a1",
        delta: Buffer.alloc(960).toString("base64"),
      });
    }
    await expect.poll(() => ui.callState()).toBe("speaking");
    realtime.send({ type: "input_audio_buffer.speech_started", item_id: "u2" });
    await expect.poll(() => ui.callState()).toBe("user");
    await expect(ui.lastAssistantLine()).toContainText("interrompu");
    await ui.hangUp();
  });

  test.describe("micro indisponible", () => {
    // startCall journalise l'erreur du micro (console.error attendu)
    test.use({ allowConsoleErrors: ["NotAllowedError", "NotFoundError"] });

    test("AP-6 : micro refusé", async ({ page, ui }) => {
      await page.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = () =>
          Promise.reject(new DOMException("refusé", "NotAllowedError"));
      });
      await ui.goto();
      await ui.startCall();
      await expect(ui.status()).toHaveText("Accès au micro refusé");
      expect(await ui.callState()).toBe("idle");
      await expect(ui.callButton()).toBeEnabled();
    });

    test("AP-6b : micro absent", async ({ page, ui }) => {
      await page.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = () =>
          Promise.reject(new DOMException("absent", "NotFoundError"));
      });
      await ui.goto();
      await ui.startCall();
      await expect(ui.status()).toHaveText("Impossible de démarrer l'appel");
    });
  });

  test("AP-7 : WebSocket fermé par le serveur en cours d'appel", async ({
    page,
    ui,
  }) => {
    const realtime = await new RealtimeMock(page).install();
    await ui.goto();
    await ui.startCall();
    await realtime.connectedSocket();
    await expect.poll(() => ui.callState()).toBe("listening");
    await realtime.close();
    await expect.poll(() => ui.callState()).toBe("idle");
    await expect(ui.status()).toHaveText("Appel terminé");
    await expect(ui.callButton()).toHaveText("Appeler");
  });

  test("AP-8 : session déjà ouverte dans un autre onglet", async ({
    page,
    ui,
  }) => {
    const realtime = await new RealtimeMock(page).install();
    await ui.goto();
    await ui.startCall();
    await realtime.connectedSocket();
    realtime.send({ type: "error", error: { code: "session_limit_reached" } });
    await expect(ui.status()).toHaveText(
      "Une conversation est déjà en cours dans un autre onglet",
    );
    expect(await ui.callState()).toBe("idle");
  });
});
