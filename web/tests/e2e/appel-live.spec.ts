// Appel sur la pile réelle (grille AP-1, AP-9, EC-1 live) : micro simulé
// (tests/fixtures/question-fr.wav), garde d'écriture active.
import { installProbes, latencies, resources } from "../support/probes";
import { expect, test } from "../support/test";

test.describe("appel réel @live @appel @lot3", () => {
  test.beforeEach(async ({ page }) => {
    await installProbes(page);
  });

  test("AP-1 : appel complet, réponse audio et annotation", async ({
    page,
    ui,
  }) => {
    test.setTimeout(120_000);
    await ui.goto();
    await ui.startCall();
    await expect
      .poll(() => ui.callState(), { timeout: 20_000 })
      .toBe("listening");
    await expect.poll(() => ui.callState(), { timeout: 20_000 }).toBe("user");
    await expect
      .poll(() => ui.callState(), { timeout: 20_000 })
      .toMatch(/thinking|speaking/);
    await expect(ui.lastAssistantLine()).toContainText(/réponse en \d+\.\d s/, {
      timeout: 60_000,
    });
    const measures = await latencies(page);
    expect(measures.length).toBeGreaterThan(0);
    test.info().annotations.push({
      type: "latence",
      description: JSON.stringify(measures[0]),
    });
    await ui.hangUp();
    await expect.poll(() => ui.callState()).toBe("idle");
    await expect
      .poll(() => resources(page))
      .toMatchObject({ audioContexts: 0, openSockets: 0 });
  });

  test("AP-9 : dix appels successifs sans ressource orpheline", async ({
    page,
    ui,
  }) => {
    test.setTimeout(180_000);
    await ui.goto();
    for (let i = 0; i < 10; i += 1) {
      await ui.startCall();
      await expect
        .poll(() => ui.callState(), { timeout: 20_000 })
        .toBe("listening");
      await ui.hangUp();
      await expect.poll(() => ui.callState()).toBe("idle");
    }
    const state = await resources(page);
    expect(state).toMatchObject({
      audioContexts: 0,
      openSockets: 0,
      socketsCreated: 10,
    });
  });

  test("EC-1 live : réponse écrite réelle", async ({ ui }) => {
    test.setTimeout(120_000);
    await ui.goto();
    await ui.sendText("Réponds seulement : bonjour.");
    await expect(ui.lastAssistantLine()).toContainText(/écrit · \d+\.\d s/, {
      timeout: 90_000,
    });
  });
});
