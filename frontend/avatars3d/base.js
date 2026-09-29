// Socle commun des avatars 3D (three.js) : rendu, environnement de reflets, caméra,
// lumières, boucle limitée à 30 images/s, lissage de l'état et du niveau audio.
// Chaque avatar hérite de cette classe et fournit build() et animate(dt, t).
// Interface identique à l'orbe : setState, setLevel, setHue, setTheme, stop.

import * as THREE from "../vendor/three/three.module.min.js";
import { RoomEnvironment } from "../vendor/three/RoomEnvironment.js";

export const lerp = (a, b, t) => a + (b - a) * t;
const BASE_HUE = 222;
const FRAME_MS = 1000 / 30;

// Texture d'usure procédurale (salissures, rayures) pour la peinture et le métal
export function grimeTexture(seed = 3, tint = [200, 205, 212]) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d");
  let state = seed;
  const random = () => (state = (state * 16807) % 2147483647) / 2147483647;
  ctx.fillStyle = `rgb(${tint.join(",")})`;
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i += 1) {
    const shade = 150 + random() * 90;
    ctx.fillStyle = `rgba(${shade},${shade},${shade + 5},${0.03 + random() * 0.04})`;
    ctx.beginPath();
    ctx.arc(random() * 512, random() * 512, 2 + random() * 16, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineWidth = 1;
  for (let i = 0; i < 140; i += 1) {
    const x = random() * 512;
    const y = random() * 512;
    ctx.strokeStyle = `rgba(245,245,250,${0.08 + random() * 0.14})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (random() - 0.5) * 60, y + (random() - 0.5) * 20);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export class Avatar3DBase {
  constructor(
    canvas,
    { camera = [0, 0, 8], target = [0, 0, 0], fov = 30 } = {},
  ) {
    this.canvas = canvas;
    this.state = "idle";
    this.target = { level: 0 };
    this.level = 0;
    this.time = 0;
    this.stopped = false;
    this.materials = [];
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;
    pmrem.dispose();

    this.fov = fov;
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 60);
    this.camera.position.set(...camera);
    this.camera.lookAt(...target);

    this.key = new THREE.DirectionalLight(0xfff4e8, 2.4);
    this.key.position.set(-3, 4, 5);
    this.rim = new THREE.DirectionalLight(0x7fb0ff, 2);
    this.rim.position.set(3, 2, -4);
    this.fill = new THREE.HemisphereLight(0xdfe8ff, 0x3a3f48, 0.8);
    this.scene.add(this.key, this.rim, this.fill);

    this.build(THREE);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    this.last = performance.now();
    requestAnimationFrame((now) => this.frame(now));
  }

  // Matériau enregistré pour être libéré à l'arrêt
  material(options) {
    const material = new THREE.MeshStandardMaterial(options);
    this.materials.push(material);
    return material;
  }

  setState(state) {
    this.state = state;
  }

  setLevel(level) {
    this.target.level = Math.max(0, Math.min(1, level));
  }

  // Nuance du domaine : couleur du contre-jour
  setHue(shift) {
    this.rim.color.setHSL(((BASE_HUE + shift) % 360) / 360, 0.8, 0.65);
  }

  setTheme(theme) {
    this.renderer.toneMappingExposure = theme === "light" ? 1.08 : 1;
  }

  stop() {
    this.stopped = true;
    this.observer.disconnect();
    this.scene.traverse((node) => node.geometry?.dispose());
    for (const material of this.materials) {
      material.map?.dispose();
      material.dispose();
    }
    this.renderer.dispose();
  }

  resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Cadre étroit : on élargit le champ pour garder le sujet entier
    this.camera.fov =
      width < height ? this.fov * (height / width) * 0.9 : this.fov;
    this.camera.updateProjectionMatrix();
  }

  frame(now) {
    if (this.stopped) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt * (this.reducedMotion ? 0.25 : 1);
    const attack = this.target.level > this.level ? 20 : 6;
    this.level = lerp(
      this.level,
      this.target.level,
      1 - Math.exp(-dt * attack),
    );
    this.animate(dt, this.time);
    // 30 images/s suffisent : le GPU est partagé avec la voix et le LLM
    if (now - (this.rendered ?? 0) >= FRAME_MS) {
      this.rendered = now;
      this.renderer.render(this.scene, this.camera);
    }
    requestAnimationFrame((next) => this.frame(next));
  }
}
