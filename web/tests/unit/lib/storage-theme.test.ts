// @vitest-environment jsdom
// Préférences (mêmes clés) et theme-init.js : auto résolu, valeur invalide, stockage en erreur
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, test, vi } from "vitest";

import { applyTheme, setDomainHue, storedTheme } from "@/engines/theme/theme";
import { readPreference, STORAGE_KEYS, writePreference } from "@/lib/storage";

// Racine de Vitest : web/ (import.meta.url n'est pas un chemin file: sous jsdom)
const THEME_INIT = readFileSync("public/theme-init.js", "utf8");

function systemPrefersLight(light: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: light,
      addEventListener() {},
      removeEventListener() {},
    })),
  );
}

function runThemeInit() {
  document.head.innerHTML = '<meta name="color-scheme" content="dark light">';
  delete document.documentElement.dataset.theme;
  new Function(THEME_INIT)();
  return {
    theme: document.documentElement.dataset.theme,
    meta: document
      .querySelector('meta[name="color-scheme"]')
      ?.getAttribute("content"),
  };
}

describe("préférences et thème", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("test_storage_cles_de_l_ancienne_interface", () => {
    expect(STORAGE_KEYS).toEqual({
      theme: "antares-theme",
      avatar: "antares-avatar",
      noiseFilter: "antares.noiseFilter",
    });
    writePreference(STORAGE_KEYS.avatar, "orb");
    expect(readPreference("antares-avatar")).toBe("orb");
  });

  test("test_storage_en_erreur_valeur_absente_sans_exception", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("refusé");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("refusé");
    });
    expect(readPreference("antares-theme")).toBeNull();
    expect(() => writePreference("antares-theme", "dark")).not.toThrow();
    expect(storedTheme()).toBe("auto");
  });

  test.each([
    [null, false, "dark"],
    [null, true, "light"],
    ["auto", true, "light"],
    ["dark", true, "dark"],
    ["light", false, "light"],
    ["violet", false, "dark"],
  ])("test_themeInit_%s_os_clair_%s_donne_%s", (stored, light, expected) => {
    systemPrefersLight(light);
    if (stored) localStorage.setItem("antares-theme", stored);
    expect(runThemeInit()).toEqual({ theme: expected, meta: expected });
  });

  test("test_themeInit_stockage_en_erreur_auto", () => {
    systemPrefersLight(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("refusé");
    });
    expect(runThemeInit().theme).toBe("light");
  });

  test("test_applyTheme_meme_resultat_que_themeInit", () => {
    systemPrefersLight(false);
    document.head.innerHTML = '<meta name="color-scheme" content="dark light">';
    expect(applyTheme("auto")).toBe("dark");
    expect(
      document
        .querySelector('meta[name="color-scheme"]')
        ?.getAttribute("content"),
    ).toBe("dark");
  });

  test("test_setDomainHue_securite_246_en_cssom", () => {
    expect(setDomainHue("Sécurité")).toBe(246);
    expect(document.documentElement.style.getPropertyValue("--hue")).toBe(
      "246",
    );
  });
});
