// Interface commune des rendus d'avatar (orbe en canvas 2D, avatars three.js au lot 4)
export type AvatarRenderer = {
  setState(state: string): void;
  setLevel(level: number): void;
  // Décalage de teinte (degrés) par rapport à la teinte de base
  setHue(shift: number): void;
  setTheme(theme: "dark" | "light"): void;
  stop(): void;
};

export type RendererClass = new (canvas: HTMLCanvasElement) => AvatarRenderer;
