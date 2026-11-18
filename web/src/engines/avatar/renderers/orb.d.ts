// Types de orb.js (module JS, sans types)
import type { AvatarRenderer } from "./types";

export declare class Orb implements AvatarRenderer {
  constructor(canvas: HTMLCanvasElement);
  setState(state: string): void;
  setLevel(level: number): void;
  setHue(shift: number): void;
  setTheme(theme: "dark" | "light"): void;
  stop(): void;
}
