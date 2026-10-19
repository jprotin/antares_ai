// Avatar de l'assistant (port de avatar.js) : un rendu à la fois dans un conteneur, même
// interface pour tous, choix mémorisé dans le navigateur (antares-avatar). Animé hors de
// React : l'état, le niveau audio, la teinte et le thème passent par des appels directs.
import { readPreference, STORAGE_KEYS, writePreference } from "@/lib/storage";

import { Bender } from "./renderers/avatars3d/bender.js";
import { VisorRobot } from "./renderers/avatars3d/visor.js";
import { Face3D } from "./renderers/face3d.js";
import { Orb } from "./renderers/orb.js";
import type { AvatarRenderer, RendererClass } from "./renderers/types";

export const AVATAR_KINDS = ["face3d", "visor", "bender", "orb"] as const;
export type AvatarKind = (typeof AVATAR_KINDS)[number];
const WEBGL = new Set<AvatarKind>(["face3d", "visor", "bender"]);
const DEFAULT: AvatarKind = "face3d";

const RENDERERS: Record<AvatarKind, RendererClass> = {
  face3d: Face3D,
  visor: VisorRobot,
  bender: Bender,
  orb: Orb,
};

// Sondé une fois ; le contexte de la sonde est rendu aussitôt (pas de contexte orphelin)
let webgl: boolean | undefined;
export function webglAvailable(): boolean {
  if (webgl === undefined) {
    try {
      const gl = document.createElement("canvas").getContext("webgl2");
      webgl = Boolean(gl);
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      webgl = false;
    }
  }
  return webgl;
}

function isKind(value: string | null): value is AvatarKind {
  return (AVATAR_KINDS as readonly string[]).includes(value ?? "");
}

export function storedAvatar(): AvatarKind {
  const kind = readPreference(STORAGE_KEYS.avatar);
  return isKind(kind) ? kind : DEFAULT;
}

type Settings = {
  state: string;
  level: number;
  hue: number;
  theme: "dark" | "light";
};

export class AvatarHost {
  kind: AvatarKind = DEFAULT;
  private container: HTMLElement | null = null;
  private current: AvatarRenderer | null = null;
  private readonly settings: Settings = {
    state: "idle",
    level: 0,
    hue: 0,
    theme: "dark",
  };
  private readonly listeners = new Set<(kind: AvatarKind) => void>();

  constructor() {
    this.kind = this.resolve(storedAvatar());
  }

  // Sans WebGL (navigateur, pilote), repli sur l'orbe
  private resolve(kind: AvatarKind): AvatarKind {
    return WEBGL.has(kind) && !webglAvailable() ? "orb" : kind;
  }

  mount(container: HTMLElement) {
    this.container = container;
    this.render();
    return () => {
      if (this.container !== container) return;
      this.current?.stop();
      this.current = null;
      container.replaceChildren();
      this.container = null;
    };
  }

  // `remember` : choix explicite de l'utilisateur, mémorisé dans le navigateur
  use(kind: AvatarKind, remember = true) {
    this.kind = this.resolve(kind);
    if (remember) writePreference(STORAGE_KEYS.avatar, this.kind);
    this.render();
    for (const listener of this.listeners) listener(this.kind);
  }

  onChange(listener: (kind: AvatarKind) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Un canvas ne change pas de contexte (2D <-> WebGL) : nouveau canvas à chaque rendu
  private render() {
    if (!this.container) return;
    this.current?.stop();
    const canvas = document.createElement("canvas");
    canvas.className = "orb";
    canvas.setAttribute("aria-hidden", "true");
    this.container.replaceChildren(canvas);
    const Renderer = RENDERERS[this.kind];
    this.current = new Renderer(canvas);
    const { state, level, hue, theme } = this.settings;
    this.current.setState(state);
    this.current.setLevel(level);
    this.current.setHue(hue);
    this.current.setTheme(theme);
  }

  setState(state: string) {
    this.settings.state = state;
    this.current?.setState(state);
  }

  setLevel(level: number) {
    this.settings.level = level;
    this.current?.setLevel(level);
  }

  setHue(hue: number) {
    this.settings.hue = hue;
    this.current?.setHue(hue);
  }

  setTheme(theme: "dark" | "light") {
    this.settings.theme = theme;
    this.current?.setTheme(theme);
  }
}

export const avatar = new AvatarHost();
