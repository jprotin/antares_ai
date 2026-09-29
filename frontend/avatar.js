// Avatar de l'assistant sur l'écran d'appel : tête de cyborg (défaut) ou orbe.
// Même interface pour les deux ; le choix est mémorisé dans le navigateur.

import { Face } from "./face.js";
import { Orb } from "./orb.js";

const STORAGE_KEY = "antares-avatar";
const RENDERERS = { face: Face, orb: Orb };

export function storedAvatar() {
  try {
    const kind = localStorage.getItem(STORAGE_KEY);
    return kind in RENDERERS ? kind : "face";
  } catch {
    return "face";
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
    this.kind = kind in RENDERERS ? kind : "face";
    this.current = new RENDERERS[this.kind](this.canvas);
    const { state, level, hue, theme } = this.settings;
    this.current.setState(state);
    this.current.setLevel(level);
    this.current.setHue(hue);
    this.current.setTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, this.kind);
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
