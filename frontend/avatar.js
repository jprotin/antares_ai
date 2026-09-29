// Avatar de l'assistant sur l'écran d'appel : photo animée (si une photo locale est
// configurée, cf. deploy/s2s/avatars), cyborg 3D, cyborg 2D ou orbe. Même interface pour
// tous ; le choix est mémorisé dans le navigateur.

import { Face } from "./face.js";
import { Face3D, webglAvailable } from "./face3d.js";
import { Orb } from "./orb.js";
import { PhotoFace, loadPhotoConfig } from "./photoface.js";

const STORAGE_KEY = "antares-avatar";
const RENDERERS = { photo: PhotoFace, face3d: Face3D, face: Face, orb: Orb };
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
    // Sans choix enregistré, la photo locale devient l'avatar par défaut si elle existe ;
    // choisie mais absente (fichier retiré), repli sur l'avatar par défaut
    loadPhotoConfig().then((config) => {
      if (config && !stored()) this.use("photo", false);
      if (!config && this.kind === "photo") this.use(DEFAULT, false);
    });
  }

  // `remember` : choix explicite de l'utilisateur, mémorisé dans le navigateur
  use(kind, remember = true) {
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
