// Avatar de l'assistant sur l'écran d'appel : cyborg 3D (défaut), cyborg 2D ou orbe.
// Même interface pour les trois ; le choix est mémorisé dans le navigateur.

import { Face } from "./face.js";
import { Face3D, webglAvailable } from "./face3d.js";
import { Orb } from "./orb.js";

const STORAGE_KEY = "antares-avatar";
const RENDERERS = { face3d: Face3D, face: Face, orb: Orb };
const DEFAULT = "face3d";

export function storedAvatar() {
  try {
    const kind = localStorage.getItem(STORAGE_KEY);
    return kind in RENDERERS ? kind : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export class Avatar {
  constructor(canvas) {
    this.canvas = canvas;
    this.settings = { state: "idle", level: 0, hue: 0, theme: "dark" };
    this.use(storedAvatar());
  }

  use(kind) {
    this.current?.stop();
    let chosen = kind in RENDERERS ? kind : DEFAULT;
    // Sans WebGL (navigateur, pilote), repli sur le cyborg 2D
    if (chosen === "face3d" && !webglAvailable()) chosen = "face";
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
    try {
      localStorage.setItem(STORAGE_KEY, kind in RENDERERS ? kind : DEFAULT);
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
