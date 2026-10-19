// Types de bender.js (porté de frontend/, imports three.js npm)
import type { AvatarRenderer } from "../types";

export declare class Bender implements AvatarRenderer {
  constructor(canvas: HTMLCanvasElement);
  setState(state: string): void;
  setLevel(level: number): void;
  setHue(shift: number): void;
  setTheme(theme: "dark" | "light"): void;
  stop(): void;
}
