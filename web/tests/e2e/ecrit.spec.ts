// Réponse écrite (grille EC, MD) en mock : flux SSE simulé de /api/chat.
import { MockApi } from "../support/mock-api";
import { expect, test } from "../support/test";

function sse(chunks: string[]): string {
  return (
    chunks
      .map(
        (content) =>
          `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n"
  );
}

test.describe("réponse écrite @mock @ecrit @lot3", () => {
  // Réponse HTTP en erreur ou coupée : le navigateur journalise l'échec de la ressource
  test.use({ allowConsoleErrors: ["Failed to load resource"] });

  test("EC-1 : réponse en flux, annotée et mémorisée", async ({ page, ui }) => {
    const api = await new MockApi(page)
      .on(/^POST \/api\/chat$/, (route) =>
        route.fulfill({
          contentType: "text/event-stream",
          body: sse(["Paris est ", "la capitale."]),
        }),
      )
      .install();
    await ui.goto();
    await ui.sendText("Quelle est la capitale de la France ?");
    await expect(ui.lastAssistantLine()).toContainText(
      "Paris est la capitale.",
    );
    await expect(ui.lastAssistantLine()).toContainText(/écrit · \d+\.\d s/);
    const chat = api.calls.find((call) => call.path === "/api/chat");
    expect(JSON.stringify(chat?.body)).toContain(
      "Quelle est la capitale de la France ?",
    );
  });

  for (const [status, message] of [
    [413, "la conversation est trop longue pour être envoyée"],
    [502, "le routeur LLM ne répond pas"],
    [504, "le modèle a mis trop de temps à répondre"],
  ] as const) {
    test(`EC-2 : erreur ${status} affichée dans la conversation`, async ({
      page,
      ui,
    }) => {
      await new MockApi(page)
        .on(/^POST \/api\/chat$/, (route) =>
          route.fulfill({ status, body: "" }),
        )
        .install();
      await ui.goto();
      await ui.sendText("Bonjour");
      await expect(ui.subtitles()).toContainText(
        `réponse impossible : ${message}`,
      );
      expect(await ui.callState()).toBe("idle");
    });
  }

  test("EC-2b : serveur injoignable", async ({ page, ui }) => {
    await new MockApi(page)
      .on(/^POST \/api\/chat$/, (route) => route.abort("failed"))
      .install();
    await ui.goto();
    await ui.sendText("Bonjour");
    await expect(ui.subtitles()).toContainText(
      "réponse impossible : le serveur est injoignable",
    );
  });

  test("MD-1 : code coloré, bouton Copier et lien externe à vérifier", async ({
    page,
    ui,
  }) => {
    const markdown = [
      "Voici :\n\n```nginx\nlocation / { root /srv; }\n```\n\n",
      "```dockerfile\nFROM nginx\n```\n\n[doc](https://example.org)",
    ];
    await new MockApi(page)
      .on(/^POST \/api\/chat$/, (route) =>
        route.fulfill({
          contentType: "text/event-stream",
          body: sse(markdown),
        }),
      )
      .install();
    await ui.goto();
    await ui.sendText("Exemple");
    const line = ui.lastAssistantLine();
    await expect(
      line.locator(".hljs-section, .hljs-keyword").first(),
    ).toBeVisible();
    await expect(
      line.getByRole("button", { name: "Copier" }).first(),
    ).toBeVisible();
    const link = line.getByRole("link", { name: "doc" });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(link).toHaveAttribute("title", /à vérifier/);
  });

  test.describe("injection", () => {
    test("MD-2 : injection HTML nettoyée", async ({ page, ui, guards }) => {
      const hostile =
        '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>Texte sûr';
      await new MockApi(page)
        .on(/^POST \/api\/chat$/, (route) =>
          route.fulfill({
            contentType: "text/event-stream",
            body: sse([hostile]),
          }),
        )
        .install();
      await ui.goto();
      await ui.sendText("Test");
      await expect(ui.lastAssistantLine()).toContainText("Texte sûr");
      expect(
        await page.evaluate(
          () => (window as unknown as { __pwned?: number }).__pwned,
        ),
      ).toBeUndefined();
      await expect(ui.lastAssistantLine().locator("img, script")).toHaveCount(
        0,
      );
      // Gestionnaires retirés avant l'analyse de DOMPurify : aucune violation CSP
      expect(await guards.csp()).toEqual([]);
    });
  });

  test.describe("amélioration", () => {
    test("MD-3 : attribut style d'une réponse sans violation CSP", async ({
      page,
      ui,
      guards,
    }) => {
      await new MockApi(page)
        .on(/^POST \/api\/chat$/, (route) =>
          route.fulfill({
            contentType: "text/event-stream",
            body: sse(['<span style="color:red">rouge</span>']),
          }),
        )
        .install();
      await ui.goto();
      await ui.sendText("Test");
      await expect(ui.lastAssistantLine()).toContainText("rouge");
      const violations = await guards.csp();
      test.info().annotations.push({
        type: "csp",
        description: `${violations.length} violation(s)`,
      });
      expect(violations).toEqual([]);
    });
  });
});
