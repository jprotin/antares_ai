// Fenêtres Connexions, Fiches et Projets du RAG intégré (grille FE-2, FE-4, FE-5) en
// mock : méthode et corps des requêtes vérifiés, confirm accepté et refusé, erreurs
// serveur affichées. En live : ouverture en lecture seule (la garde refuse toute écriture).
import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";

import { MockApi } from "../support/mock-api";
import { expect, test } from "../support/test";

const connections = JSON.parse(
  readFileSync(
    new URL("../fixtures/api/connections.json", import.meta.url),
    "utf8",
  ),
) as { services: { rag: Record<string, unknown> } };

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

// Ne garde que les écritures vers un chemin donné
function writesTo(api: MockApi, method: string, path: string) {
  return api
    .writes()
    .filter((call) => call.method === method && call.path === path);
}

// Formulaire refermé : attribut hidden posé (ancienne interface : `.agent-form` impose
// display:grid et le laisse affiché, défaut noté dans PARITY) ou formulaire retiré du DOM
async function formClosed(page: Page, selector: string) {
  const form = page.locator(selector);
  await expect
    .poll(
      async () =>
        (await form.count()) === 0 ||
        (await form.getAttribute("hidden")) !== null,
    )
    .toBe(true);
}

function nextDialog(page: Page, accept: boolean) {
  page.once("dialog", (dialog) =>
    accept ? dialog.accept() : dialog.dismiss(),
  );
}

test.describe("fenêtres CRUD @mock @fenetres @lot5", () => {
  test.describe("FE-2 : Connexions", () => {
    // Ancienne interface : pattern="[a-z0-9][a-z0-9-]{0,31}" de #provider-id invalide en
    // mode v des expressions régulières, Chromium le signale en console (sans validation)
    test.use({ allowConsoleErrors: ["Pattern attribute value"] });

    test("FE-2 : nouveau fournisseur, test puis enregistrement", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page)
        .on(/^POST \/api\/connections\/test$/, (route) =>
          route.fulfill({
            json: {
              ok: true,
              seconds: 0.2,
              count: 3,
              firstModel: "mon-api/modele-test",
              firstToken: { seconds: 0.5 },
            },
          }),
        )
        .install();
      await ui.goto();
      await ui.openDialog("connections");
      const dialog = ui.dialog("connections");
      await expect(dialog.locator("#providers-list .agent-card")).toHaveCount(
        2,
      );
      await expect(dialog.locator("#providers-list")).toContainText(
        "7 modèle(s)",
      );
      await expect(dialog.locator("#fallback-model")).toHaveValue(
        "litellm-ai-to-boost/gemma4:e4b",
      );

      await dialog.locator("#provider-new").click();
      await page.locator("#provider-name").fill("Mon API");
      await expect(page.locator("#provider-id")).toHaveValue("mon-api");
      await page.locator("#provider-url").fill("https://api.exemple.test/v1");
      await page.locator("#provider-test").click();
      await expect(page.locator("#provider-result")).toHaveText(
        "Joignable en 0.2 s : 3 modèle(s) · 1er mot en 0.5 s (mon-api/modele-test)",
      );
      expect(
        writesTo(api, "POST", "/api/connections/test")[0]?.body,
      ).toMatchObject({
        id: "mon-api",
        name: "Mon API",
        type: "openai",
        url: "https://api.exemple.test/v1",
      });

      await page.locator("#provider-form [type=submit]").click();
      await formClosed(page, "#provider-form");
      expect(
        writesTo(api, "PUT", "/api/connections/providers/mon-api")[0]?.body,
      ).toMatchObject({
        id: "mon-api",
        name: "Mon API",
        url: "https://api.exemple.test/v1",
        keep_key: true,
      });
    });

    test("FE-2b : suppression d'un fournisseur avec confirm, repli protégé", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page).install();
      await ui.goto();
      await ui.openDialog("connections");
      const cards = ui
        .dialog("connections")
        .locator("#providers-list .agent-card");
      // Le fournisseur du modèle de repli ne se supprime pas
      await expect(
        cards.filter({ hasText: "LiteLLM" }).getByRole("button", {
          name: "Supprimer",
        }),
      ).toHaveCount(0);
      const remove = cards
        .filter({ hasText: "Ollama" })
        .getByRole("button", { name: "Supprimer" });

      nextDialog(page, false);
      await remove.click();
      expect(
        writesTo(api, "DELETE", "/api/connections/providers/ollama"),
      ).toEqual([]);

      nextDialog(page, true);
      await remove.click();
      await expect
        .poll(
          () =>
            writesTo(api, "DELETE", "/api/connections/providers/ollama").length,
        )
        .toBe(1);
    });

    test("FE-2c : modèle de repli enregistré dans les réglages", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page).install();
      await ui.goto();
      await ui.openDialog("connections");
      await page
        .locator("#fallback-model")
        .selectOption("litellm-ai-to-boost/gemma4:12b");
      await expect
        .poll(() => writesTo(api, "PUT", "/api/settings")[0]?.body)
        .toEqual({ fallback: "litellm-ai-to-boost/gemma4:12b" });
    });

    test("FE-2d : services RAG, recherche, Claude et MCP", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page)
        .on(/^POST \/api\/connections\/services\/search\/test$/, (route) =>
          route.fulfill({
            json: { ok: true, detail: "SearXNG répond", seconds: 0.1 },
          }),
        )
        .install();
      await ui.goto();
      await ui.openDialog("connections");
      const services = page.locator("#services .service");
      const rag = services.nth(0);
      const search = services.nth(1);
      const claude = services.nth(2);
      const mcp = services.nth(3);

      await rag.locator('input[value="none"]').check();
      await rag.getByRole("button", { name: "Enregistrer" }).click();
      await expect(rag.getByRole("status")).toHaveText(
        "Enregistré (pris en compte immédiatement).",
      );
      expect(
        writesTo(api, "PUT", "/api/connections/services/rag")[0]?.body,
      ).toEqual({
        mode: "none",
        url: "http://rag:8100",
        qdrant_url: "http://qdrant:6333",
        write_token: "",
      });

      await search.getByRole("button", { name: "Tester" }).click();
      await expect(search.getByRole("status")).toHaveText(
        "SearXNG répond (0.1 s)",
      );
      expect(
        writesTo(api, "POST", "/api/connections/services/search/test")[0]?.body,
      ).toEqual({ enabled: true, url: "http://searxng:8080" });

      await claude.locator('input[name="models"]').fill("opus, sonnet, haiku");
      await claude.getByRole("button", { name: "Enregistrer" }).click();
      await expect(claude.getByRole("status")).toContainText("Enregistré");
      expect(
        writesTo(api, "PUT", "/api/connections/services/claude")[0]?.body,
      ).toMatchObject({ enabled: true, models: ["opus", "sonnet", "haiku"] });

      await mcp.locator('input[name="name"]').fill("Outils Test");
      await mcp.locator('input[name="url"]').fill("http://outils:8000/mcp");
      await mcp.getByRole("button", { name: "Enregistrer" }).last().click();
      await expect
        .poll(
          () =>
            writesTo(api, "PUT", "/api/connections/mcp/outils-test")[0]?.body,
        )
        .toMatchObject({
          id: "outils-test",
          name: "Outils Test",
          url: "http://outils:8000/mcp",
          transport: "http",
        });

      const removeMcp = page
        .locator("#services .service__row", { hasText: "Démo MCP" })
        .getByRole("button", { name: "Supprimer" });
      nextDialog(page, false);
      await removeMcp.click();
      expect(writesTo(api, "DELETE", "/api/connections/mcp/demo-mcp")).toEqual(
        [],
      );
      nextDialog(page, true);
      await removeMcp.click();
      await expect
        .poll(
          () => writesTo(api, "DELETE", "/api/connections/mcp/demo-mcp").length,
        )
        .toBe(1);
    });

    test.describe("erreurs", () => {
      test.use({
        allowConsoleErrors: [
          "Failed to load resource",
          "Pattern attribute value",
        ],
      });

      test("FE-2e : test en échec et enregistrement refusé affichés", async ({
        page,
        ui,
      }) => {
        await new MockApi(page)
          .on(/^POST \/api\/connections\/test$/, (route) =>
            route.fulfill({ json: { ok: false, error: "connexion refusée" } }),
          )
          .on(/^PUT \/api\/connections\/providers\//, (route) =>
            route.fulfill({
              status: 422,
              json: { detail: "adresse invalide" },
            }),
          )
          .install();
        await ui.goto();
        await ui.openDialog("connections");
        await page.locator("#provider-new").click();
        await page.locator("#provider-name").fill("Panne");
        await page.locator("#provider-url").fill("http://panne:1/v1");
        await page.locator("#provider-test").click();
        await expect(page.locator("#provider-result")).toHaveText(
          "Échec : connexion refusée",
        );
        await page.locator("#provider-form [type=submit]").click();
        await expect(page.locator("#provider-result")).toHaveText(
          "adresse invalide",
        );
        await expect(page.locator("#provider-form")).toBeVisible();
      });

      test("FE-2f : liste des connexions indisponible", async ({
        page,
        ui,
      }) => {
        await new MockApi(page)
          .on(/^GET \/api\/connections$/, (route) =>
            route.fulfill({ status: 502, json: { detail: "routeur absent" } }),
          )
          .install();
        await ui.goto();
        await ui.openDialog("connections");
        await expect(page.locator("#connections-error")).toHaveText(
          "routeur absent",
        );
      });
    });
  });

  test.describe("FE-4 : Fiches de connaissance", () => {
    const cards = [
      {
        id: "fiche-commune",
        title: "Convention de nommage",
        project: "",
        state: "active",
        updated: 1_760_000_000,
        source: { name: "conversation" },
        valid_until: null,
      },
      {
        id: "fiche-sandbox",
        title: "Ancienne procédure",
        project: "sandbox",
        state: "obsolete",
        updated: 1_760_000_000,
        source: { name: "guide.md" },
        valid_until: "2027-01-01",
      },
    ];

    test("FE-4 : panneau, obsolescence et suppression avec confirm", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page).install();
      api.set("knowledge", { enabled: true, cards });
      await ui.goto();
      await ui.openDialog("knowledge");
      const panel = ui.dialog("knowledge");
      await expect(panel.locator(".agents__group h3")).toHaveText([
        "Commun",
        "sandbox",
      ]);
      const common = panel.locator(".agent-card", {
        hasText: "Convention de nommage",
      });
      const obsolete = panel.locator(".agent-card", {
        hasText: "Ancienne procédure",
      });
      await expect(common).toContainText("active");
      await expect(obsolete).toContainText("obsolète");
      await expect(obsolete).toContainText("valable jusqu'au 2027-01-01");
      // Une fiche déjà obsolète ne propose plus « Obsolète »
      await expect(
        obsolete.getByRole("button", { name: "Obsolète" }),
      ).toHaveCount(0);

      await common.getByRole("button", { name: "Obsolète" }).click();
      await expect
        .poll(
          () =>
            writesTo(api, "POST", "/api/knowledge/fiche-commune/obsolete")
              .length,
        )
        .toBe(1);

      const remove = panel
        .locator(".agent-card", { hasText: "Ancienne procédure" })
        .getByRole("button", { name: "Supprimer" });
      nextDialog(page, false);
      await remove.click();
      expect(writesTo(api, "DELETE", "/api/knowledge/fiche-sandbox")).toEqual(
        [],
      );
      nextDialog(page, true);
      await remove.click();
      await expect
        .poll(
          () => writesTo(api, "DELETE", "/api/knowledge/fiche-sandbox").length,
        )
        .toBe(1);
    });

    test("FE-4b : indexation désactivée et liste vide signalées", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page).install();
      api.set("knowledge", { enabled: false, cards: [] });
      await ui.goto();
      await ui.openDialog("knowledge");
      const panel = ui.dialog("knowledge");
      await expect(panel).toContainText("Indexation désactivée");
      await expect(panel).toContainText("Aucune fiche pour l'instant");
    });

    test("FE-4c : proposer depuis la conversation, éditer, remplacer, indexer", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page)
        .on(/^POST \/api\/chat$/, (route) =>
          route.fulfill({
            contentType: "text/event-stream",
            body: sse(["Les noms de branches ", "suivent GitFlow."]),
          }),
        )
        .on(/^POST \/api\/knowledge\/draft$/, (route) =>
          route.fulfill({
            json: {
              draft: {
                title: "Branches GitFlow",
                body: "Les noms de branches suivent GitFlow.",
                tags: ["git"],
                valid_until: null,
                project: "sandbox",
                source: { name: "conversation" },
              },
              similar: [],
              cut: false,
            },
          }),
        )
        .on(/^POST \/api\/knowledge\/similar$/, (route) =>
          route.fulfill({
            json: [
              {
                id: "fiche-ancienne",
                title: "Branches (ancien)",
                score: 0.82,
                created: 1_760_000_000,
              },
            ],
          }),
        )
        .on(/^POST \/api\/knowledge$/, (route, recorded) =>
          route.fulfill({
            json: (recorded.body as { card: unknown }).card,
          }),
        )
        .install();
      await ui.goto();

      // Conversation vide : rien à proposer
      await page.locator("#propose-knowledge").click();
      await expect(ui.subtitles()).toContainText(
        "Rien à proposer : la conversation est vide.",
      );

      await ui.sendText("Comment nommer les branches ?");
      await expect(ui.lastAssistantLine()).toContainText("suivent GitFlow.");
      await page.locator("#propose-knowledge").click();
      const editor = page.locator("#knowledge-edit");
      await expect(page.locator("#knowledge-form")).toBeVisible();
      await expect(page.locator("#knowledge-status")).toHaveText(
        "Source : conversation. Relisez et corrigez avant d'indexer.",
      );
      const draft = writesTo(api, "POST", "/api/knowledge/draft")[0]?.body as {
        messages: { content: string }[];
      };
      expect(JSON.stringify(draft.messages)).toContain(
        "Comment nommer les branches ?",
      );
      await expect(page.locator("#knowledge-project")).toHaveValue("sandbox");
      await expect(page.locator("#knowledge-similar")).toContainText(
        "Aucune fiche proche",
      );

      await page.locator("#knowledge-title").fill("Nommage des branches");
      await page.locator("#knowledge-tags").fill("git, gitflow");
      // Changer de projet relance la recherche des fiches proches
      await page.locator("#knowledge-project").selectOption("");
      await expect(page.locator("#knowledge-similar")).toContainText(
        "Branches (ancien)",
      );
      expect(
        writesTo(api, "POST", "/api/knowledge/similar")[0]?.body,
      ).toMatchObject({ title: "Nommage des branches", project: "" });
      await page
        .locator('#knowledge-similar input[value="fiche-ancienne"]')
        .check();
      await page.locator("#knowledge-save").click();

      await expect(editor).not.toHaveAttribute("open");
      expect(writesTo(api, "POST", "/api/knowledge")[0]?.body).toMatchObject({
        card: {
          title: "Nommage des branches",
          tags: ["git", "gitflow"],
          project: "",
          valid_until: null,
        },
        replaces: ["fiche-ancienne"],
      });
      await expect(ui.subtitles()).toContainText(
        "Fiche indexée : Nommage des branches (commun) — 1 fiche(s) remplacée(s)",
      );
    });

    test.describe("erreurs", () => {
      test.use({ allowConsoleErrors: ["Failed to load resource"] });

      test("FE-4d : rédaction impossible affichée", async ({ page, ui }) => {
        await new MockApi(page)
          .on(/^POST \/api\/chat$/, (route) =>
            route.fulfill({
              contentType: "text/event-stream",
              body: sse(["Réponse."]),
            }),
          )
          .on(/^POST \/api\/knowledge\/draft$/, (route) =>
            route.fulfill({
              status: 502,
              json: { detail: "modèle indisponible" },
            }),
          )
          .install();
        await ui.goto();
        await ui.sendText("Bonjour");
        await expect(ui.lastAssistantLine()).toContainText("Réponse.");
        await page.locator("#propose-knowledge").click();
        await expect(page.locator("#knowledge-status")).toHaveText(
          "Fiche impossible : modèle indisponible",
        );
        await formClosed(page, "#knowledge-form");
      });
    });
  });

  test.describe("FE-5 : Projets du RAG intégré", () => {
    const integrated = {
      ...connections,
      services: {
        ...connections.services,
        rag: { ...connections.services.rag, mode: "integrated" },
      },
    };
    const documents = [
      { id: "doc-guide", source: "guide.md", kind: "markdown", chunks: 4 },
    ];

    test("FE-5 : réservé au RAG intégré", async ({ page, ui }) => {
      await new MockApi(page).install();
      await ui.goto();
      await ui.openDialog("rag-projects");
      await expect(page.locator("#rag-projects-error")).toContainText(
        "Disponible avec le RAG intégré",
      );
      for (const id of [
        "#rag-project",
        "#rag-project-new",
        "#rag-add",
        "#rag-drop",
      ]) {
        await expect(page.locator(id)).toBeDisabled();
      }
    });

    test("FE-5b : créer un projet en y ajoutant un fichier", async ({
      page,
      ui,
    }) => {
      let filename = "";
      const api = await new MockApi(page)
        .on(/^POST \/api\/rag\/projects\/[^/]+\/documents$/, (route) => {
          filename = route.request().headers()["x-filename"] ?? "";
          return route.fulfill({ json: { chunks: 3 } });
        })
        .install();
      api.set("connections", integrated);
      await ui.goto();
      await ui.openDialog("rag-projects");
      await expect(page.locator("#rag-project option")).toHaveCount(2);

      await page.locator("#rag-project-new").fill("Mon Appli");
      const chooser = page.waitForEvent("filechooser");
      await page.locator("#rag-add").click();
      await (
        await chooser
      ).setFiles({
        name: "notes de projet.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# Notes\n\nContenu de test."),
      });
      await expect(page.locator("#rag-status")).toHaveText(
        "1 document(s) indexé(s) dans mon-appli (3 extraits)",
      );
      const post = writesTo(
        api,
        "POST",
        "/api/rag/projects/mon-appli/documents",
      );
      expect(post).toHaveLength(1);
      expect(post[0]?.body).toBe("# Notes\n\nContenu de test.");
      expect(decodeURIComponent(filename)).toBe("notes de projet.md");
      await expect(page.locator("#rag-project-new")).toHaveValue("");
    });

    test("FE-5c : sans projet ni nom, l'ajout est refusé", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page).install();
      api.set("connections", integrated);
      api.set("projects", []);
      await ui.goto();
      await ui.openDialog("rag-projects");
      await expect(page.locator("#rag-project")).toContainText(
        "Aucun projet : en créer un",
      );
      await expect(page.locator("#rag-drop")).toBeDisabled();
      await page.locator("#rag-add").click();
      await expect(page.locator("#rag-status")).toHaveText(
        "Choisir un projet ou saisir le nom d'un nouveau projet",
      );
    });

    test("FE-5d : retirer un document et supprimer le projet avec confirm", async ({
      page,
      ui,
    }) => {
      const api = await new MockApi(page).install();
      api.set("connections", integrated);
      api.set("rag/projects/sandbox/documents", documents);
      await ui.goto();
      await ui.openDialog("rag-projects");
      await page.locator("#rag-project").selectOption("sandbox");
      const card = page.locator("#rag-documents .agent-card");
      await expect(card).toContainText("guide.md");
      await expect(card).toContainText("markdown · 4 extrait(s)");

      const retire = card.getByRole("button", { name: "Retirer" });
      nextDialog(page, false);
      await retire.click();
      expect(
        writesTo(
          api,
          "DELETE",
          "/api/rag/projects/sandbox/documents/doc-guide",
        ),
      ).toEqual([]);
      nextDialog(page, true);
      await retire.click();
      await expect
        .poll(
          () =>
            writesTo(
              api,
              "DELETE",
              "/api/rag/projects/sandbox/documents/doc-guide",
            ).length,
        )
        .toBe(1);

      await page.locator("#rag-project").selectOption("sandbox");
      nextDialog(page, false);
      await page.locator("#rag-drop").click();
      expect(writesTo(api, "DELETE", "/api/rag/projects/sandbox")).toEqual([]);
      nextDialog(page, true);
      await page.locator("#rag-drop").click();
      await expect(page.locator("#rag-status")).toHaveText(
        "Projet sandbox supprimé",
      );
      expect(writesTo(api, "DELETE", "/api/rag/projects/sandbox")).toHaveLength(
        1,
      );
    });

    test.describe("erreurs", () => {
      test.use({ allowConsoleErrors: ["Failed to load resource"] });

      test("FE-5e : fichier trop volumineux et suppression refusée", async ({
        page,
        ui,
      }) => {
        const api = await new MockApi(page)
          .on(/^POST \/api\/rag\/projects\/[^/]+\/documents$/, (route) =>
            route.fulfill({ status: 413, body: "" }),
          )
          .on(/^DELETE \/api\/rag\/projects\/sandbox$/, (route) =>
            route.fulfill({
              status: 409,
              json: { detail: "projet utilisé par les réglages" },
            }),
          )
          .install();
        api.set("connections", integrated);
        await ui.goto();
        await ui.openDialog("rag-projects");
        await page.locator("#rag-project").selectOption("sandbox");
        const chooser = page.waitForEvent("filechooser");
        await page.locator("#rag-add").click();
        await (
          await chooser
        ).setFiles({
          name: "gros.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("%PDF-1.4"),
        });
        await expect(page.locator("#rag-status")).toHaveText(
          "0 document(s) indexé(s) dans sandbox (0 extraits) — échecs : gros.pdf : fichier trop volumineux (15 Mo au maximum)",
        );

        nextDialog(page, true);
        await page.locator("#rag-drop").click();
        await expect(page.locator("#rag-status")).toHaveText(
          "projet utilisé par les réglages",
        );
      });
    });
  });
});

// Vraie API, lecture seule : les trois fenêtres s'ouvrent et affichent leurs données
test.describe("fenêtres CRUD @live @fenetres @lot5", () => {
  test("FE-2 live : Connexions affiche fournisseurs et services", async ({
    page,
    ui,
  }) => {
    await ui.goto();
    await ui.openDialog("connections");
    await expect(
      page.locator("#providers-list .agent-card").first(),
    ).toBeVisible();
    await expect(page.locator("#services .service")).toHaveCount(4);
    await expect(page.locator("#connections-error")).toHaveText("");
  });

  test("FE-4 live : panneau des fiches", async ({ page, ui }) => {
    await ui.goto();
    await ui.openDialog("knowledge");
    await expect(
      page
        .locator("#knowledge-cards")
        .locator(".agents__group, .agents__empty")
        .first(),
    ).toBeVisible();
  });

  test("FE-5 live : Projets du RAG intégré", async ({ page, ui }) => {
    await ui.goto();
    await ui.openDialog("rag-projects");
    // Selon le mode RAG réglé : message d'indisponibilité ou liste des projets
    await expect
      .poll(async () => {
        const error = await page.locator("#rag-projects-error").textContent();
        const options = await page.locator("#rag-project option").count();
        return Boolean(error?.trim()) || options > 0;
      })
      .toBe(true);
  });
});
