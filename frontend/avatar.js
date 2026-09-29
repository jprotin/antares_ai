// Avatar de l'assistant sur l'écran d'appel : avatars 3D (cyborg, Chappie…) ou orbe.
// Même interface pour tous ; le choix est mémorisé dans le navigateur.

import { Face3D, webglAvailable } from "./face3d.js";
import { Orb } from "./orb.js";
import { Bender } from "./avatars3d/bender.js";
import { VisorRobot } from "./avatars3d/visor.js";

const STORAGE_KEY = "antares-avatar";
const RENDERERS = {
  face3d: Face3D,
  visor: VisorRobot,
  bender: Bender,
  orb: Orb,
};
// Avatars WebGL : repli sur l'orbe (canvas 2D) sans WebGL
const WEBGL = new Set(["face3d", "visor", "bender"]);
const DEFAULT = "face3d";

function stored() {
  try {
    const kind = localStorage.getItem(STORAGE_KEY);
    return kind in RENDERERS ? kind : null;
  } catch {
    return null;
  }
}

export function storedAvatar() {
  return stored() ?? DEFAULT;
}

export class Avatar {
  constructor(canvas) {
    this.canvas = canvas;
    this.settings = { state: "idle", level: 0, hue: 0, theme: "dark" };
    this.use(storedAvatar(), false);
  }

  // `remember` : choix explicite de l'utilisateur, mémorisé dans le navigateur
  use(kind, remember = true) {
    this.current?.stop();
    let chosen = kind in RENDERERS ? kind : DEFAULT;
    // Sans WebGL (navigateur, pilote), repli sur l'orbe
    if (WEBGL.has(chosen) && !webglAvailable()) chosen = "orb";
    // Un canvas ne change pas de contexte (2D <-> WebGL) : on le remplace
    const fresh = this.canvas.cloneNode(false);
    this.canvas.replaceWith(fresh);
    this.canvas = fresh;
    this.kind = chosen;
    this.current = new RENDERERS[chosen](this.canvas);
    const { state, level, hue, theme } = this.settings;
    this.current.setState(state);
    this.current.setLevel(level);
    this.current.setHue(hue);
    this.current.setTheme(theme);
    if (!remember) return;
    try {
      localStorage.setItem(STORAGE_KEY, chosen);
    } catch {
      // Stockage indisponible : le choix vaut pour la session
    }
  }

  setState(state) {
    this.settings.state = state;
    this.current.setState(state);
  }

  setLevel(level) {
    this.settings.level = level;
    this.current.setLevel(level);
  }

  setHue(hue) {
    this.settings.hue = hue;
    this.current.setHue(hue);
  }

  setTheme(theme) {
    this.settings.theme = theme;
    this.current.setTheme(theme);
  }
}
