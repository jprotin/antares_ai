// Répétition (grille RE) en mock : API des répétitions simulée, WebSocket realtime
// simulé, horloge de la page pilotée (page.clock). Aucune répétition réelle touchée.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import type { Page } from "@playwright/test";

import { MockApi } from "../support/mock-api";
import { expect, test } from "../support/test";
import { RealtimeMock } from "../support/ws-scenario";

type Rehearsal = Record<string, unknown> & {
  id: string;
  report?: Record<string, unknown>;
};

const SAVED: Rehearsal = JSON.parse(
  readFileSync(
    new URL("../fixtures/api/rehearsal_report.json", import.meta.url),
    "utf8",
  ),
);
const NEW_ID = "repetition-test-9";
// Rapport imprimé : référence de l'ancienne interface (RE-4)
const PDF_BASELINE = new URL("../baseline/report-pdf.json", import.meta.url);
const PDF_PRESENT = [
  "Répétition de test 3",
  "Points forts",
  "À améliorer, pas à pas",
  "À ne pas dire",
  "Questions-réponses",
  "Rythme et temps",
  "Annexe · révisions de la note",
];
// Barre (étapes, micro, Quitter), contrôles du rapport, discussion ouverte
const PDF_ABSENT = [
  "Filtre du bruit",
  "Quitter",
  "Imprimer / PDF",
  "Discuter de la note",
  "Écouter",
  "Le créneau réel était de 30 secondes.",
];
// Image PNG 1 × 1 servie pour chaque slide
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
// En-tête minimal : le PDF n'est pas lu, l'API simulée renvoie les slides
const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");

function fresh(): Rehearsal {
  const { report: _report, discussion: _discussion, ...rest } = SAVED;
  return {
    ...rest,
    id: NEW_ID,
    title: "presentation test",
    talk: null,
    qa: [],
  };
}

function reported(): Rehearsal {
  const report = {
    ...(SAVED.report as object),
    initial_score: null,
    revisions: [],
  };
  return { ...fresh(), report, discussion: [] };
}

function discussed(): Rehearsal {
  const base = reported();
  const report = {
    ...(base.report as object),
    score: 6,
    initial_score: 7,
    revisions: [
      {
        at: 1791987049.3,
        criterion: "pace",
        label: "Rythme et gestion du temps",
        before: 2,
        after: 1,
        reason: "Créneau réel plus court que prévu.",
      },
    ],
  };
  return {
    ...base,
    report,
    discussion: [
      { role: "user", text: "Le créneau était de 30 secondes.", via: "text" },
      {
        role: "assistant",
        text: "Je revois le rythme d'un point.",
        via: "text",
      },
    ],
  };
}

async function rehearsalApi(page: Page) {
  const api = new MockApi(page)
    .on(/^GET \/api\/rehearsals\/[^/]+\/slides\/\d+$/, (route) =>
      route.fulfill({ contentType: "image/png", body: PNG }),
    )
    .on(/^POST \/api\/rehearsals$/, (route) =>
      route.fulfill({ json: { id: NEW_ID } }),
    )
    .on(/^POST \/api\/rehearsals\/[^/]+\/slides$/, (route) =>
      route.fulfill({ json: fresh() }),
    )
    .on(/^POST \/api\/rehearsals\/[^/]+\/report$/, (route) =>
      route.fulfill({ json: reported() }),
    )
    .on(/^POST \/api\/rehearsals\/[^/]+\/discussion$/, (route) =>
      route.fulfill({ json: { rehearsal: discussed() } }),
    );
  api.set(`rehearsals/${SAVED.id}`, SAVED);
  return api.install();
}

function texts(realtime: RealtimeMock): string[] {
  return realtime.received
    .filter((event) => event.type === "conversation.item.create")
    .map((event) => JSON.stringify(event));
}

// Répétition lancée depuis la fenêtre de préparation, calibrage du bruit terminé
async function startRehearsal(
  page: Page,
  realtime: RealtimeMock,
  duringCalibration?: () => Promise<void>,
) {
  await page.locator("#open-rehearsal").click();
  const setup = page.locator("#rehearsal-setup");
  await expect(setup).toHaveAttribute("open", "");
  await page.locator("#rehearsal-pdf").setInputFiles({
    name: "presentation-test.pdf",
    mimeType: "application/pdf",
    buffer: PDF,
  });
  await expect(page.locator("#rehearsal-title")).toHaveValue(
    "presentation test",
  );
  await page.locator("#rehearsal-target").fill("1");
  await page.getByRole("button", { name: "Commencer" }).click();
  await expect(page.locator("#rehearsal")).toBeVisible();
  await realtime.connectedSocket();
  await expect(page.locator("#rehearsal-hint")).toContainText(
    "je mesure le bruit",
  );
  await duringCalibration?.();
  await page.clock.fastForward(3_500);
  await expect(page.locator("#rehearsal-hint")).toContainText(
    "Je vous écoute sans vous interrompre",
  );
}

function say(realtime: RealtimeMock, item: string, transcript: string) {
  realtime.send({ type: "input_audio_buffer.speech_started", item_id: item });
  realtime.send({ type: "input_audio_buffer.speech_stopped", item_id: item });
  realtime.send({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: item,
    transcript,
  });
}

test.describe("répétition @mock @repetition @lot6", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
  });

  test("RE-1 : discours, questions, rapport lu, discussion et historique", async ({
    page,
    ui,
  }) => {
    const api = await rehearsalApi(page);
    const realtime = await new RealtimeMock(page).install();
    await ui.goto();
    await startRehearsal(page, realtime);

    // Discours : horloge, slides, segments transcrits
    const clock = page.locator("#rehearsal-clock");
    await page.clock.fastForward(5_000);
    await expect(clock).toHaveText("0:05 / 1:00");
    await expect(page.locator("#rehearsal-count")).toHaveText("1 / 3");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#rehearsal-count")).toHaveText("2 / 3");
    say(realtime, "u1", "Bonjour à tous, voici notre projet de migration.");
    await expect(page.locator("#rehearsal-caption")).toContainText(
      "voici notre projet",
    );
    await page.clock.fastForward(60_000);
    await expect(clock).toHaveClass(/is-over/);

    await page
      .getByRole("button", { name: "J'ai terminé mon discours" })
      .click();
    await expect(page.locator('[data-step="qa"]')).toHaveClass(/is-current/);
    const talk = api
      .writes()
      .find((call) => call.path === `/api/rehearsals/${NEW_ID}/talk`);
    expect(talk?.method).toBe("PUT");
    expect(JSON.stringify(talk?.body)).toContain("voici notre projet");
    await expect
      .poll(() => texts(realtime).some((t) => t.includes("[Fin du discours]")))
      .toBe(true);
    expect(
      api
        .writes()
        .filter(
          (call) =>
            call.method === "PUT" && call.path === "/api/rehearsals/live",
        )
        .map((call) => (call.body as { phase: string }).phase),
    ).toEqual(["speech", "qa"]);

    // Questions : une question du public, une réponse
    realtime.send({
      type: "response.output_audio_transcript.done",
      item_id: "a1",
      transcript: "Quel est le coût total ?",
    });
    realtime.send({ type: "response.done", response: { id: "r1" } });
    say(realtime, "u2", "Environ cent mille euros au total.");
    await expect(page.locator("#rehearsal-caption")).toContainText(
      "cent mille euros",
    );

    // Rapport : analyse, rendu, lecture partie par partie
    await page.getByRole("button", { name: "Voir le rapport" }).click();
    const report = page.locator("#rehearsal-report");
    await expect(report.locator(".report__score")).toContainText("7");
    const qa = api
      .writes()
      .find((call) => call.path === `/api/rehearsals/${NEW_ID}/qa`);
    expect(qa?.body).toEqual({
      exchanges: [
        { role: "assistant", text: "Quel est le coût total ?" },
        { role: "user", text: "Environ cent mille euros au total." },
      ],
    });
    for (const part of [0, 1]) {
      await expect
        .poll(() =>
          texts(realtime).some((t) => t.includes(`[Rapport, partie ${part}]`)),
        )
        .toBe(true);
      await expect(
        report.locator(".report__section.is-reading"),
      ).toHaveAttribute("data-section", part === 0 ? "score" : "strengths");
      realtime.send({ type: "response.done", response: { id: `r${part}` } });
    }
    await expect(ui.status()).toHaveText("Rapport présenté");

    // Discussion écrite : note révisée
    await page.getByRole("button", { name: "Discuter de la note" }).click();
    await page.locator("#discussion-text").fill("Le créneau était de 30 s.");
    await page.locator("#discussion-send").click();
    await expect(page.locator("#discussion-score")).toHaveText(
      "6/20 · initialement 7/20",
    );
    await expect(report).toContainText("Note révisée (initialement 7/20)");
    const posted = api
      .writes()
      .find((call) => call.path === `/api/rehearsals/${NEW_ID}/discussion`);
    expect(posted?.body).toEqual({ text: "Le créneau était de 30 s." });

    await page.getByRole("button", { name: "Terminer" }).click();
    await expect(page.locator("#rehearsal")).toBeHidden();
    await expect.poll(() => ui.callState()).toBe("idle");
    await expect(ui.status()).toHaveText("Répétition terminée");
    expect(
      api
        .writes()
        .some(
          (call) =>
            call.method === "DELETE" && call.path === "/api/rehearsals/live",
        ),
    ).toBe(true);

    // Historique : rapport enregistré, suppression avec confirm
    await page.locator("#open-rehearsal").click();
    const history = page.locator("#rehearsal-history");
    await expect(history.locator(".agent-card")).toHaveCount(3);
    const saved = history
      .locator(".agent-card")
      .filter({ hasText: "Répétition de test 3" });
    await expect(saved).toContainText("7/20");
    const before = api.writes().length;
    page.once("dialog", (dialog) => dialog.dismiss());
    await saved.getByRole("button", { name: "Supprimer" }).click();
    expect(api.writes().length).toBe(before);
    page.once("dialog", (dialog) => dialog.accept());
    await saved.getByRole("button", { name: "Supprimer" }).click();
    await expect
      .poll(() =>
        api
          .writes()
          .some(
            (call) =>
              call.method === "DELETE" &&
              call.path === `/api/rehearsals/${SAVED.id}`,
          ),
      )
      .toBe(true);
    await saved.getByRole("button", { name: "Rapport" }).click();
    await expect(page.locator("#rehearsal")).toBeVisible();
    await expect(report).toContainText("Répétition de test 3");
    await expect(clock).toHaveText("59 s");
  });

  test("RE-1b : quitter en plein discours demande confirmation", async ({
    page,
    ui,
  }) => {
    await rehearsalApi(page);
    const realtime = await new RealtimeMock(page).install();
    await ui.goto();
    await startRehearsal(page, realtime);
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Quitter" }).click();
    await expect(page.locator("#rehearsal")).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Quitter" }).click();
    await expect(page.locator("#rehearsal")).toBeHidden();
    await expect.poll(() => ui.callState()).toBe("idle");
  });

  test("RE-2 : flèches sans effet si une fenêtre est ouverte ou le focus dans un champ", async ({
    page,
    ui,
  }) => {
    await rehearsalApi(page);
    const realtime = await new RealtimeMock(page).install();
    await ui.goto();
    await startRehearsal(page, realtime);
    const count = page.locator("#rehearsal-count");

    await page.keyboard.press("ArrowRight");
    await expect(count).toHaveText("2 / 3");
    await page.keyboard.press("PageDown");
    await expect(count).toHaveText("3 / 3");
    await page.keyboard.press("ArrowLeft");
    await expect(count).toHaveText("2 / 3");

    // Focus dans un champ : le filtre du bruit (select)
    await page.locator("#rehearsal-noise").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(count).toHaveText("2 / 3");
    await page.locator("#rehearsal-noise").blur();

    // Fenêtre ouverte : les Réglages
    await ui.openDialog("settings");
    await page.keyboard.press("ArrowRight");
    await expect(count).toHaveText("2 / 3");
    await ui.closeDialog("settings", "escape");
    await expect.poll(() => ui.isDialogOpen("settings")).toBe(false);
    await page.keyboard.press("ArrowRight");
    await expect(count).toHaveText("3 / 3");
  });

  test("RE-3 : filtre de bruit, calibrage silencieux, seuil VAD et réglage mémorisé", async ({
    page,
    ui,
  }) => {
    await rehearsalApi(page);
    const realtime = await new RealtimeMock(page).install();
    await ui.goto();
    await expect(page.locator("#rehearsal-noise")).toHaveValue("normal");
    // Pendant le calibrage, le moteur ne reçoit que du silence (micro simulé parlant)
    const appended = () =>
      realtime.received.filter(
        (event) => event.type === "input_audio_buffer.append",
      );
    await startRehearsal(page, realtime, async () => {
      await expect.poll(() => appended().length).toBeGreaterThan(10);
      expect(
        appended().every((event) => /^A+=*$/.test(String(event.audio))),
      ).toBe(true);
    });

    const thresholds = () =>
      realtime.received
        .filter((event) => event.type === "session.update")
        .map(
          (event) =>
            (
              event.session as {
                audio?: { input?: { turn_detection?: { threshold?: number } } };
              }
            ).audio?.input?.turn_detection?.threshold,
        );
    // Ouverture de l'appel : seuil du filtre « Normal »
    expect(thresholds()[0]).toBe(0.8);
    await expect(page.locator("#rehearsal-mic-state")).toHaveText(
      /Bruit filtré|Voix captée/,
    );

    await page.locator("#rehearsal-noise").selectOption("strong");
    await expect.poll(() => thresholds().at(-1)).toBe(0.88);
    expect(
      await page.evaluate(() => localStorage.getItem("antares.noiseFilter")),
    ).toBe("strong");

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Quitter" }).click();
    await page.reload();
    await expect(page.locator("#rehearsal-noise")).toHaveValue("strong");
  });

  test("RE-4 : impression du rapport, sans barre, discussion ni contrôles", async ({
    page,
    ui,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "page.pdf() : Chromium seulement");
    await rehearsalApi(page);
    await ui.goto();
    await page.locator("#open-rehearsal").click();
    await page
      .locator("#rehearsal-history .agent-card")
      .filter({ hasText: "Répétition de test 3" })
      .getByRole("button", { name: "Rapport" })
      .click();
    const report = page.locator("#rehearsal-report");
    await expect(report).toContainText("Répétition de test 3");
    await page.getByRole("button", { name: "Discuter de la note" }).click();
    await expect(page.locator("#rehearsal-discussion")).toBeVisible();

    await page.emulateMedia({ media: "print" });
    for (const hidden of [
      ".rehearsal__bar",
      "#rehearsal-discussion",
      "#rehearsal-caption",
      ".report__controls",
      ".report__play",
      ".topbar, .app > :not(.rehearsal)",
    ]) {
      for (const node of await page.locator(hidden).all()) {
        await expect(node, hidden).toBeHidden();
      }
    }
    await expect(report.locator(".report__section").first()).toBeVisible();
    await expect(report.locator(".report__annex")).toBeVisible();

    // PDF de référence (TASK-20) : pages et textes, comparés à tests/baseline
    const file = test.info().outputPath("rapport.pdf");
    await page.pdf({ path: file, format: "A4", printBackground: true });
    const pages = Number(
      /Pages:\s+(\d+)/.exec(
        execFileSync("pdfinfo", [file], { encoding: "utf8" }),
      )?.[1],
    );
    const text = execFileSync("pdftotext", ["-layout", file, "-"], {
      encoding: "utf8",
    }).replace(/\s+/g, " ");
    // Titres en capitales (text-transform) : comparaison sans casse
    const lower = text.toLowerCase();
    for (const shown of PDF_PRESENT)
      expect(lower, shown).toContain(shown.toLowerCase());
    for (const absent of PDF_ABSENT)
      expect(lower, absent).not.toContain(absent.toLowerCase());
    const baseline = {
      pages,
      format: "A4",
      present: PDF_PRESENT,
      absent: PDF_ABSENT,
    };
    if (!existsSync(PDF_BASELINE) || process.env.UPDATE_BASELINE) {
      writeFileSync(PDF_BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
    }
    const reference = JSON.parse(readFileSync(PDF_BASELINE, "utf8"));
    expect(pages, "pages du PDF").toBe(reference.pages);
    await page.emulateMedia({ media: "screen" });
  });
});
