// Store : tranches profil, conversation, appel et fenêtres
import { describe, expect, test, vi } from "vitest";

import {
  nextTheme,
  resolveTheme,
  watchSystemTheme,
} from "@/engines/theme/theme";
import { createAppStore } from "@/state/store";
import { currentVoice } from "@/state/slices/profile";

describe("store", () => {
  test("test_remember_contenu_vide_ignore_et_rogne", () => {
    const store = createAppStore();
    store.getState().remember("user", "  bonjour  ");
    store.getState().remember("assistant", "   ");
    store.getState().remember("assistant", undefined);
    expect(store.getState().messages).toEqual([
      { role: "user", content: "bonjour" },
    ]);
  });

  test("test_setCallState_libelle_par_defaut_ou_detail", () => {
    const store = createAppStore();
    expect(store.getState().status).toBe("Disponible pour un appel");
    store.getState().setCallState("listening");
    expect(store.getState().status).toBe("Je vous écoute");
    store.getState().setCallState("idle", "Appel terminé");
    expect(store.getState()).toMatchObject({
      callState: "idle",
      status: "Appel terminé",
    });
    store.getState().setStatus("Je cherche sur internet…");
    expect(store.getState().status).toBe("Je cherche sur internet…");
  });

  test("test_fenetres_empilees_et_fermees_dans_l_ordre", () => {
    const store = createAppStore();
    store.getState().showDialog("settings");
    store.getState().showDialog("agents");
    expect(store.getState()).toMatchObject({
      dialogs: ["settings", "agents"],
      openDialog: "agents",
    });
    store.getState().closeDialog();
    expect(store.getState().openDialog).toBe("settings");
    store.getState().showDialog("connections");
    store.getState().closeDialog("settings");
    expect(store.getState().dialogs).toEqual(["connections"]);
    store.getState().closeDialog();
    expect(store.getState().openDialog).toBeNull();
  });

  test("test_catalogChanged_incremente", () => {
    const store = createAppStore();
    store.getState().catalogChanged();
    expect(store.getState().catalogVersion).toBe(1);
  });

  test("test_currentVoice_reglage_sinon_premiere", () => {
    const store = createAppStore();
    const voices = [
      { id: "ryan", name: "Mr Antares", file: "ryan.wav" },
      { id: "sohee", name: "Miss Antares", file: "sohee.wav" },
    ];
    store.getState().setProfile({ voices });
    expect(currentVoice(store.getState())?.id).toBe("ryan");
    store.getState().setProfile({ settings: { voice: "sohee" } });
    expect(currentVoice(store.getState())?.id).toBe("sohee");
  });
});

describe("thème", () => {
  test("test_nextTheme_cycle_auto_sombre_clair", () => {
    expect(nextTheme("auto")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");
    expect(nextTheme("light")).toBe("auto");
  });

  test("test_watchSystemTheme_abonne_et_desabonne", () => {
    const media = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => media),
    );
    expect(resolveTheme("auto")).toBe("light");
    const onChange = () => {};
    const stop = watchSystemTheme(onChange);
    expect(media.addEventListener).toHaveBeenCalledWith("change", onChange);
    stop();
    expect(media.removeEventListener).toHaveBeenCalledWith("change", onChange);
    vi.unstubAllGlobals();
  });
});
