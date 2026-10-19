// Lot 3 : lignes de conversation, réseau, libellés, points d'extension (TASK-43)
import { describe, expect, test, vi } from "vitest";

import { registerCallPlugins } from "@/app/bootstrap";
import type { FeatureDef } from "@/app/types";
import {
  netLabel,
  netTitle,
  startNetMonitor,
  watchSearch,
} from "@/engines/net/netMonitor";
import { PluginHost } from "@/engines/realtime/plugins";
import {
  messageItem,
  realtimeUrl,
  sessionUpdate,
} from "@/engines/realtime/protocol";
import { modelLabel, projectLabel } from "@/lib/labels";
import { filter } from "@/features/pickers/filter";
import { fencedCode, lastTurn } from "@/lib/turn";
import { isAnyDialogOpen } from "@/state/slices/ui";
import { createAppStore } from "@/state/store";

vi.mock("@/app/runtime", () => ({ avatar: {}, engine: {} }));
vi.mock("@/features/attachments", () => ({ loadDocuments: vi.fn() }));

describe("lignes de la conversation", () => {
  test("test_writeLine_partiel_puis_final_avec_ajout", () => {
    const store = createAppStore();
    const { writeLine } = store.getState();
    writeLine("a1", "assistant", "Bon", { append: true, who: "Miss Antares" });
    writeLine("a1", "assistant", "jour", { append: true });
    expect(store.getState().lines[0]).toMatchObject({
      text: "Bonjour",
      partial: true,
      who: "Miss Antares",
    });
    writeLine("a1", "assistant", "Bonjour !", { final: true });
    expect(store.getState().lines[0]).toMatchObject({
      text: "Bonjour !",
      partial: false,
    });
  });

  test("test_annotate_et_ligne_systeme", () => {
    const store = createAppStore();
    const state = store.getState();
    state.writeLine("u1", "user", "Salut", { final: true });
    state.annotate("u1", "écrit");
    state.annotate("u1", "agent : Revue");
    state.annotate(undefined, "ignoré");
    state.systemLine("Connexion Internet perdue", true);
    const [user, system] = store.getState().lines;
    expect(user?.who).toBe("Vous");
    expect(user?.meta).toEqual(["écrit", "agent : Revue"]);
    expect(system).toMatchObject({ role: "system", error: true });
    store.getState().clearLines();
    expect(store.getState().lines).toEqual([]);
  });

  test("test_appendToLastAssistant_seulement_si_reponse", () => {
    const store = createAppStore();
    store.getState().appendToLastAssistant("perdu");
    store.getState().remember("assistant", "Voici");
    store.getState().appendToLastAssistant("\n\n```sh\nls\n```");
    expect(store.getState().messages.at(-1)?.content).toBe(
      "Voici\n\n```sh\nls\n```",
    );
  });
});

describe("réseau", () => {
  const online = { online: true, search: true, sharing: false };

  test.each([
    [{ online: false }, "Hors ligne"],
    [online, "Internet"],
    [{ ...online, sharing: true }, "Internet · partagé"],
  ])("test_netLabel_%j", (state, label) => {
    expect(netLabel(state)).toBe(label);
  });

  test("test_netTitle_recherche_indisponible_et_partage", () => {
    expect(netTitle({ ...online, search: false, sharing: true })).toBe(
      "Connecté à Internet : recherche web indisponible (SearXNG ne répond pas), modèles Claude disponibles — Partage ngrok en cours : Claude et l'écriture dans le RAG sont désactivés",
    );
  });

  test("test_startNetMonitor_bascules_apres_le_premier_releve", async () => {
    vi.useFakeTimers();
    const states = [
      online,
      online,
      { ...online, online: false },
      { ...online, sharing: true },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(states.shift() ?? online))),
    );
    vi.stubGlobal("window", globalThis);
    const onChange = vi.fn();
    const onSharing = vi.fn();
    const stop = startNetMonitor({ onState: () => {}, onChange, onSharing });
    for (let i = 0; i < 4; i += 1) await vi.advanceTimersByTimeAsync(15000);
    stop();
    expect(onChange.mock.calls).toEqual([[false], [true]]);
    expect(onSharing.mock.calls).toEqual([[true], [false]]);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

describe("libellés et protocole", () => {
  test.each([
    ["claude:sonnet", "Claude Sonnet (hors local)"],
    ["ollama/gemma4:e4b", "gemma4:e4b"],
    ["litellm/gemma4:12b", "gemma4:12b (litellm)"],
    ["seul", "seul"],
    [undefined, "?"],
  ])("test_modelLabel_%s", (name, label) => {
    expect(modelLabel(name)).toBe(label);
  });

  test("test_projectLabel_vide", () => {
    expect(projectLabel("")).toBe("aucun (projet cité par son nom)");
    expect(projectLabel("sandbox")).toBe("sandbox");
  });

  test("test_fencedCode_mots_cles_en_dernier", () => {
    expect(
      fencedCode([
        { lang: "tags", code: "nginx" },
        { lang: "sh", code: "ls" },
      ]),
    ).toBe("```sh\nls\n```\n\n```tags\nnginx\n```");
  });

  test("test_protocole_session_et_message", () => {
    expect(
      sessionUpdate({
        instructions: "x",
        voice: "/voices/a.wav",
        vadThreshold: 0.8,
      }),
    ).toMatchObject({
      session: {
        audio: {
          input: { turn_detection: { threshold: 0.8 } },
          output: { voice: "/voices/a.wav" },
        },
      },
    });
    expect(messageItem("msg_1", "assistant", "ok").item.content).toEqual([
      { type: "output_text", text: "ok" },
    ]);
    expect(
      realtimeUrl({ protocol: "https:", host: "exemple.org" } as Location),
    ).toBe("wss://exemple.org/v1/realtime");
  });
});

describe("points d'extension (TASK-43)", () => {
  test("test_PluginHost_agrege_et_desinscrit", () => {
    const host = new PluginHost();
    const events: string[] = [];
    const reasons: string[] = [];
    const off = host.register({
      id: "factice",
      onEvent: (event) => events.push(event.type),
      active: () => true,
      silent: () => false,
      holdMic: () => true,
      onCallEnded: (reason) => reasons.push(reason),
    });
    host.event({ type: "response.done" });
    host.callEnded("Appel terminé");
    expect([host.active(), host.silent(), host.holdMic()]).toEqual([
      true,
      false,
      true,
    ]);
    expect(events).toEqual(["response.done"]);
    expect(reasons).toEqual(["Appel terminé"]);
    off();
    expect([host.active(), host.holdMic()]).toEqual([false, false]);
  });

  test("test_registerCallPlugins_branche_les_plugins_declares", () => {
    const host = new PluginHost();
    const target = { plugins: host } as never;
    const features: FeatureDef[] = [
      { id: "sans-plugin" },
      {
        id: "factice",
        callPlugin: () => ({ id: "factice", silent: () => true }),
      },
    ];
    expect(registerCallPlugins(features, target)).toHaveLength(1);
    expect(host.silent()).toBe(true);
  });

  test("test_rootData_et_fenetre_ouverte", () => {
    const store = createAppStore();
    store.getState().setRootData("rehearsal", "report");
    expect(store.getState().rootData).toEqual({ rehearsal: "report" });
    store.getState().setRootData("rehearsal", null);
    expect(store.getState().rootData).toEqual({});
    expect(isAnyDialogOpen(store.getState())).toBe(false);
    store.getState().showDialog("settings");
    expect(isAnyDialogOpen(store.getState())).toBe(true);
  });
});

describe("recherche web et dernier tour", () => {
  test("test_watchSearch_signale_les_bascules_puis_s_arrete", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const answers = [false, true, true, false];
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ online: true, searching: answers.shift() ?? false }),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const seen: boolean[] = [];
    const stop = watchSearch((searching) => seen.push(searching));
    for (let i = 0; i < 4; i += 1) await vi.advanceTimersByTimeAsync(600);
    stop();
    await vi.advanceTimersByTimeAsync(1200);
    const calls = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1200);
    expect(seen).toEqual([true, false]);
    expect(fetch.mock.calls.length).toBe(calls);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("test_lastTurn_ancien_tour_ignore", async () => {
    const turn = { at: 1000, projects: [], sources: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(turn))),
    );
    expect(await lastTurn(999_000)).toEqual(turn);
    expect(await lastTurn(1_000_001)).toBeNull();
    vi.unstubAllGlobals();
  });

  test("test_patchLine_et_reglages_d_interface", () => {
    const store = createAppStore();
    const state = store.getState();
    state.writeLine("a1", "assistant", "x", { final: true });
    state.patchLine("a1", { rich: true, refs: ["projet · doc"] });
    expect(store.getState().lines[0]).toMatchObject({
      rich: true,
      refs: ["projet · doc"],
    });
    state.setNet({ online: false });
    state.setWriting(true);
    state.setHalfDuplex(true);
    expect(store.getState()).toMatchObject({
      net: { online: false },
      writing: true,
      halfDuplex: true,
    });
  });
});

describe("recherche du sélecteur", () => {
  const keywords = ["Revue sécurité", "Audit d'une configuration", "Sécurité"];
  test.each([
    ["securite", 1],
    ["  REVUE ", 1],
    ["audit", 1],
    ["", 1],
    ["python", 0],
  ])("test_filter_%j_%d", (search, score) => {
    expect(filter("x", search, keywords)).toBe(score);
  });
});
