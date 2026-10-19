// Types de orb.js (porté tel quel de frontend/orb.js)
import type { AvatarRenderer } from "./types";

export declare class Orb implements AvatarRenderer {
  constructor(canvas: HTMLCanvasElement);
  setState(state: string): void;
  setLevel(level: number): void;
  setHue(shift: number): void;
  setTheme(theme: "dark" | "light"): void;
  stop(): void;
}
