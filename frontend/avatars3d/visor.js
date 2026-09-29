// Chappie (robot à visière) : tête en volumes arrondis, peinture gris bleuté usée, deux antennes,
// yeux en matrice de LED dans une visière de verre (expressions selon l'état) et écran
// de bouche en égaliseur qui suit la voix. Modèle original.

import { RoundedBoxGeometry } from "../vendor/three/RoundedBoxGeometry.js";
import { Avatar3DBase, grimeTexture, lerp } from "./base.js";

const COLS = 5;
const ROWS = 4;
const BARS = 11;

// Motifs des yeux : fonction (colonne, ligne, temps) -> intensité 0..1
const EYES = {
  neutral: (c, r) => (c >= 1 && c <= 3 && r >= 1 && r <= 2 ? 1 : 0),
  wide: (c, r) => (c >= 1 && c <= 3 && r >= 0 && r <= 3 ? 1 : 0),
  blink: (c, r) => (c >= 1 && c <= 3 && r === 2 ? 1 : 0),
  happy: (c, r) =>
    (r === 1 && (c === 1 || c === 3)) ||
    (r === 0 && c === 2) ||
    (r === 2 && (c === 0 || c === 4))
      ? 1
      : 0,
  // Réflexion : un point qui fait le tour de l'œil
  loading: (c, r, t) => {
    const ring = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [4, 1],
      [4, 2],
      [4, 3],
      [3, 3],
      [2, 3],
      [1, 3],
      [0, 3],
      [0, 2],
      [0, 1],
    ];
    const head = Math.floor(t * 14) % ring.length;
    for (let k = 0; k < 4; k += 1) {
      const [x, y] = ring[(head - k + ring.length) % ring.length];
      if (x === c && y === r) return 1 - k * 0.25;
    }
    return 0;
  },
};

export class VisorRobot extends Avatar3DBase {
  constructor(canvas) {
    super(canvas, { camera: [0, 0.15, 9.2], target: [0, -0.15, 0], fov: 30 });
    this.blinkAt = 3;
    this.tilt = 0;
  }

  build(THREE) {
    this.THREE = THREE;
    const paint = this.material({
      color: 0x8c99a8,
      map: grimeTexture(5, [120, 132, 146]),
      metalness: 0.55,
      roughness: 0.62,
    });
    const darkPaint = this.material({
      color: 0x3b424b,
      metalness: 0.6,
      roughness: 0.5,
    });
    const steel = this.material({
      color: 0xb9c0c8,
      metalness: 0.95,
      roughness: 0.3,
    });
    const glass = this.material({
      color: 0x060a10,
      metalness: 0.3,
      roughness: 0.06,
      envMapIntensity: 1.6,
    });
    const orange = this.material({
      color: 0xe0621c,
      metalness: 0.3,
      roughness: 0.45,
    });
    const black = this.material({
      color: 0x15181c,
      metalness: 0.5,
      roughness: 0.5,
    });
    this.ledOff = new THREE.Color(0x0c2733);
    this.ledOn = new THREE.Color(0x8fe3ff);

    const rounded = (w, h, d, r, material) =>
      new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 5, r), material);

    this.head = new THREE.Group();
    this.head.position.y = 0.2;
    this.scene.add(this.head);

    // Crâne, bandeau, bloc inférieur
    const skull = rounded(1.7, 1.0, 1.35, 0.16, paint);
    skull.position.set(0, 0.62, 0);
    const band = rounded(1.84, 0.2, 1.42, 0.07, darkPaint);
    band.position.set(0, 0.16, 0.02);
    const lower = rounded(1.2, 0.62, 1.1, 0.12, paint);
    lower.position.set(0, -0.55, 0.05);
    const cheeks = rounded(1.62, 0.42, 1.2, 0.1, paint);
    cheeks.position.set(0, -0.12, -0.02);
    this.head.add(skull, band, lower, cheeks);

    // Plaque frontale (zone d'étiquette) et vis
    const plate = rounded(0.72, 0.3, 0.05, 0.03, darkPaint);
    plate.position.set(-0.15, 0.78, 0.69);
    plate.rotation.z = 0.06;
    this.head.add(plate);
    for (const [x, y] of [
      [-0.7, 0.95],
      [0.7, 0.95],
      [-0.7, 0.4],
      [0.7, 0.4],
    ]) {
      const bolt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.04, 12),
        steel,
      );
      bolt.rotation.x = Math.PI / 2;
      bolt.position.set(x, y, 0.69);
      this.head.add(bolt);
    }

    // Visière de verre et matrice de LED
    const visor = rounded(1.5, 0.36, 0.1, 0.05, glass);
    visor.position.set(0, -0.12, 0.6);
    this.head.add(visor);
    this.leds = [];
    const ledGeometry = new THREE.BoxGeometry(0.06, 0.05, 0.02);
    for (const side of [-1, 1]) {
      for (let r = 0; r < ROWS; r += 1) {
        for (let c = 0; c < COLS; c += 1) {
          const material = this.material({
            color: 0x000000,
            emissive: this.ledOff.clone(),
            emissiveIntensity: 2.4,
          });
          const led = new THREE.Mesh(ledGeometry, material);
          led.position.set(
            side * 0.38 + (c - 2) * 0.075,
            -0.12 + (1.5 - r) * 0.065,
            0.66,
          );
          this.head.add(led);
          this.leds.push({ led, material, c, r, side });
        }
      }
    }
    this.eyeLight = new THREE.PointLight(0x8fe3ff, 0.8, 1.6, 2);
    this.eyeLight.position.set(0, -0.12, 0.9);
    this.head.add(this.eyeLight);

    // Écran de bouche : barres d'égaliseur
    const screen = rounded(0.78, 0.36, 0.06, 0.03, glass);
    screen.position.set(0, -0.58, 0.62);
    this.head.add(screen);
    this.bars = [];
    for (let i = 0; i < BARS; i += 1) {
      const material = this.material({
        color: 0x000000,
        emissive: this.ledOn.clone(),
        emissiveIntensity: 1.8,
      });
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.26, 0.02),
        material,
      );
      bar.position.set((i - (BARS - 1) / 2) * 0.062, -0.58, 0.66);
      this.head.add(bar);
      this.bars.push(bar);
    }

    // Arceau de menton
    const guard = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.05, 12, 40, Math.PI),
      darkPaint,
    );
    guard.rotation.z = Math.PI;
    guard.scale.set(1, 0.55, 1);
    guard.position.set(0, -0.72, 0.2);
    this.head.add(guard);

    // Disques latéraux (oreilles) et antennes
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 0.14, 32),
        darkPaint,
      );
      ear.rotation.z = Math.PI / 2;
      ear.position.set(side * 0.92, 0.35, -0.05);
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 0.18, 24),
        steel,
      );
      cap.rotation.z = Math.PI / 2;
      cap.position.set(side * 0.96, 0.35, -0.05);
      this.head.add(ear, cap);
    }
    this.antennas = [];
    const antenna = (material, x, y, z, length, width, lean) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      pivot.rotation.z = lean;
      const stick = rounded(width, length, width * 0.6, width * 0.25, material);
      stick.position.y = length / 2;
      pivot.add(stick);
      this.head.add(pivot);
      this.antennas.push({ pivot, lean });
    };
    antenna(orange, -0.55, 1.1, -0.1, 0.8, 0.09, 0.08);
    antenna(black, -0.25, 1.1, -0.2, 0.55, 0.05, -0.05);
    antenna(black, 0.95, 0.5, -0.05, 1.5, 0.14, -0.55);

    // Cou et épaules
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.26, 0.6, 24),
      darkPaint,
    );
    neck.position.set(0, -1.1, -0.1);
    this.scene.add(neck);
    for (const side of [-1, 1]) {
      const piston = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.7, 16),
        steel,
      );
      piston.position.set(side * 0.35, -1.1, 0.05);
      piston.rotation.z = side * 0.25;
      this.scene.add(piston);
      // Épaulières posées sur le buste, légèrement relevées vers l'extérieur
      const shoulder = rounded(1.25, 0.38, 1.1, 0.14, paint);
      shoulder.position.set(side * 1.05, -1.42, -0.25);
      shoulder.rotation.z = side * 0.14;
      this.scene.add(shoulder);
    }
    // Buste qui relie cou et épaules
    const chest = rounded(1.9, 0.8, 1.05, 0.16, darkPaint);
    chest.position.set(0, -1.75, -0.35);
    this.scene.add(chest);
    const lamp = rounded(0.5, 0.42, 0.25, 0.05, black);
    lamp.position.set(-1.2, -1.02, 0.05);
    const lampGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.4, 0.32),
      this.material({
        color: 0xffffff,
        emissive: 0xfff4dc,
        emissiveIntensity: 1.2,
      }),
    );
    lampGlass.position.set(-1.2, -1.02, 0.18);
    this.scene.add(lamp, lampGlass);
  }

  expression(t) {
    const s = this.state;
    if (s === "thinking" || s === "connecting") return "loading";
    if (s === "speaking") return this.level > 0.15 ? "happy" : "neutral";
    if (s === "listening" || s === "user") return "wide";
    // Repos : clignement de temps en temps
    if (t > this.blinkAt) {
      if (t > this.blinkAt + 0.14) this.blinkAt = t + 2.5 + Math.random() * 3;
      return "blink";
    }
    return "neutral";
  }

  animate(dt, t) {
    const pattern = EYES[this.expression(t)];
    const brightness = this.state === "idle" ? 0.55 : 1;
    for (const { material, c, r, side } of this.leds) {
      // L'œil droit est le miroir du gauche (expressions symétriques)
      const col = side > 0 ? COLS - 1 - c : c;
      const on = pattern(col, r, t) * brightness;
      material.emissive.lerpColors(this.ledOff, this.ledOn, on);
    }
    this.eyeLight.intensity = 0.3 + brightness * 0.8;

    // Égaliseur : suit le niveau de la voix de l'assistant
    const speaking = this.state === "speaking";
    this.bars.forEach((bar, i) => {
      const wave = 0.5 + 0.5 * Math.sin(t * 18 + i * 1.7) * Math.sin(t * 7 + i);
      const height = speaking ? 0.12 + this.level * (0.6 + 0.4 * wave) : 0.06;
      bar.scale.y = lerp(bar.scale.y, height, 1 - Math.exp(-dt * 25));
      bar.material.emissiveIntensity = speaking ? 2 : 0.6;
    });

    // Tête : inclinaison curieuse à l'écoute, légers mouvements, antennes à ressort
    const curious =
      this.state === "listening" || this.state === "user" ? 0.12 : 0;
    this.tilt = lerp(this.tilt, curious, 1 - Math.exp(-dt * 3));
    this.head.rotation.z = this.tilt + Math.sin(t * 0.7) * 0.02;
    this.head.rotation.y = Math.sin(t * 0.3) * 0.18;
    this.head.rotation.x =
      Math.sin(t * 0.5) * 0.03 +
      (this.state === "user" ? this.level * 0.05 : 0);
    this.head.position.y = 0.2 + Math.sin(t * 1.2) * 0.02;
    for (const { pivot, lean } of this.antennas) {
      pivot.rotation.z =
        lean + Math.sin(t * 3.1 + lean * 10) * 0.03 + this.level * 0.04;
    }
  }
}
