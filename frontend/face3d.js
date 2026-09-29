// Tête de cyborg en 3D temps réel (three.js, WebGL) : modèle original construit ici
// (plaques extrudées biseautées, métal à reflets d'environnement, yeux émissifs,
// mâchoire sur charnière suivie par les vérins). Même interface que l'orbe.

import * as THREE from "./vendor/three/three.module.min.js";
import { RoomEnvironment } from "./vendor/three/RoomEnvironment.js";

const MOTION = {
  idle: { eyes: 0.45, sway: 1, nod: 0 },
  connecting: { eyes: 0.7, sway: 0.6, nod: 0 },
  listening: { eyes: 0.8, sway: 0.35, nod: 0.02 },
  user: { eyes: 0.9, sway: 0.2, nod: 0.05 },
  thinking: { eyes: 0.9, sway: 0.5, nod: -0.03 },
  speaking: { eyes: 1, sway: 0.3, nod: 0 },
};
const BASE_HUE = 222;
const lerp = (a, b, t) => a + (b - a) * t;

export function webglAvailable() {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}

// Forme 2D (x, y) -> THREE.Shape ; `holes` : autres contours à évider
function shape(points, holes = []) {
  const result = new THREE.Shape(
    points.map(([x, y]) => new THREE.Vector2(x, y)),
  );
  for (const hole of holes) {
    result.holes.push(
      new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))),
    );
  }
  return result;
}

function plate(points, depth, bevel, material, holes = []) {
  const geometry = new THREE.ExtrudeGeometry(shape(points, holes), {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 16,
  });
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

// Courbe une plaque extrudée autour de l'axe vertical (visage qui suit le crâne)
function bend(mesh, strength) {
  const position = mesh.geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    position.setZ(i, position.getZ(i) - strength * x * x);
  }
  mesh.geometry.computeVertexNormals();
  return mesh;
}

function mirror(points) {
  return points.map(([x, y]) => [-x, y]).reverse();
}

// Halo additif (lueur des yeux) sans post-traitement
function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,120,90,1)");
  g.addColorStop(0.25, "rgba(255,40,20,0.8)");
  g.addColorStop(1, "rgba(255,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export class Face3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = "idle";
    this.target = { level: 0 };
    this.level = 0;
    this.jaw = 0;
    this.eyes = MOTION.idle.eyes;
    this.time = 0;
    this.stopped = false;
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    this.camera.position.set(0, -0.1, 8.6);
    this.camera.lookAt(0, -0.25, 0);

    this.build();
    this.lights();

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    this.last = performance.now();
    requestAnimationFrame((now) => this.frame(now));
  }

  build() {
    // Métal clair, légèrement dépoli : un chrome parfait reflète surtout du noir ici
    const chrome = new THREE.MeshStandardMaterial({
      color: 0xdfe3e8,
      metalness: 1,
      roughness: 0.33,
      envMapIntensity: 1.4,
    });
    const steel = new THREE.MeshStandardMaterial({
      color: 0xa6adb6,
      metalness: 1,
      roughness: 0.4,
      envMapIntensity: 1.3,
    });
    const darkSteel = new THREE.MeshStandardMaterial({
      color: 0x3a3f47,
      metalness: 0.9,
      roughness: 0.45,
    });
    const cavity = new THREE.MeshStandardMaterial({
      color: 0x07080a,
      metalness: 0.2,
      roughness: 0.9,
    });
    const tooth = new THREE.MeshStandardMaterial({
      color: 0xe9e4d8,
      metalness: 0.35,
      roughness: 0.3,
    });
    const rubber = new THREE.MeshStandardMaterial({
      color: 0x15171b,
      metalness: 0.1,
      roughness: 0.7,
    });
    this.materials = [chrome, steel, darkSteel, cavity, tooth, rubber];

    this.head = new THREE.Group();
    this.scene.add(this.head);

    // Boîte crânienne : sphère aplatie sur les côtés, légèrement allongée
    const cranium = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), chrome);
    // Calotte plus basse et plus large : elle enveloppe le haut du visage
    cranium.scale.set(0.9, 1.0, 1.02);
    cranium.position.set(0, 0.5, -0.22);
    this.head.add(cranium);

    // Joints de plaques (sillons sur le crâne)
    const seam = new THREE.Mesh(
      new THREE.TorusGeometry(0.985, 0.012, 8, 96, Math.PI),
      darkSteel,
    );
    seam.scale.set(0.9, 1.0, 1.02);
    seam.position.copy(cranium.position);
    seam.rotation.y = Math.PI / 2;
    this.head.add(seam);
    for (const side of [-1, 1]) {
      const temple = new THREE.Mesh(
        new THREE.TorusGeometry(0.62, 0.01, 8, 64, Math.PI * 0.9),
        darkSteel,
      );
      temple.position.set(side * 0.62, 0.52, -0.05);
      temple.rotation.set(0, (side * Math.PI) / 2, Math.PI * 0.55);
      this.head.add(temple);
    }

    // Masque facial : arcade, pommettes et maxillaire, orbites et nez évidés
    const outline = [
      [0, 0.34],
      [0.46, 0.36],
      [0.74, 0.3],
      [0.8, 0.1],
      [0.74, -0.14],
      [0.6, -0.34],
      [0.44, -0.5],
      [0.3, -0.56],
      [0, -0.58],
    ];
    const full = [...outline.slice(0, -1), ...mirror(outline)];
    const socket = (side) =>
      [
        [0.1, 0.24],
        [0.52, 0.26],
        [0.62, 0.14],
        [0.56, -0.03],
        [0.16, -0.05],
        [0.08, 0.08],
      ]
        .map(([x, y]) => [side * x, y])
        .reverse();
    const nose = [
      [-0.1, -0.12],
      [0, -0.1],
      [0.1, -0.12],
      [0.06, -0.3],
      [-0.06, -0.3],
    ];
    const mask = plate(full, 0.22, 0.05, chrome, [
      socket(1).reverse(),
      socket(-1),
      nose,
    ]);
    bend(mask, 0.55);
    mask.position.set(0, 0.02, 0.6);
    this.head.add(mask);

    // Fonds d'orbites et de cavité nasale (profondeur)
    const back = plate(
      [
        [-0.66, 0.3],
        [0.66, 0.3],
        [0.66, -0.32],
        [-0.66, -0.32],
      ],
      0.05,
      0.01,
      cavity,
    );
    // Courbée comme le masque et en retrait : invisible hors des orbites
    bend(back, 0.55);
    back.position.set(0, 0.02, 0.52);
    this.head.add(back);

    // Arcade sourcilière saillante
    const brow = plate(
      [
        [-0.78, 0.33],
        [0, 0.29],
        [0.78, 0.33],
        [0.72, 0.24],
        [0.1, 0.22],
        [0, 0.18],
        [-0.1, 0.22],
        [-0.72, 0.24],
      ],
      0.12,
      0.035,
      steel,
    );
    bend(brow, 0.55);
    brow.position.set(0, 0.02, 0.84);
    this.head.add(brow);

    // Pommettes en relief
    for (const side of [-1, 1]) {
      const cheek = plate(
        [
          [0.2, -0.12],
          [0.68, -0.08],
          [0.72, -0.2],
          [0.5, -0.34],
          [0.26, -0.3],
        ].map(([x, y]) => [side * x, y]),
        0.08,
        0.03,
        steel,
      );
      bend(cheek, 0.55);
      cheek.position.set(0, 0.02, 0.84);
      this.head.add(cheek);
    }

    // Yeux : sphères émissives, halo additif, lumière rouge dans l'orbite
    const eyeMaterial = new THREE.MeshStandardMaterial({
      color: 0x220000,
      emissive: 0xff2a14,
      emissiveIntensity: 3,
    });
    this.eyeMaterial = eyeMaterial;
    this.glows = [];
    this.eyeLights = [];
    const glowMap = glowTexture();
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.075, 24, 16),
        eyeMaterial,
      );
      eye.position.set(side * 0.34, 0.12, 0.68);
      this.head.add(eye);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowMap,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
        }),
      );
      glow.scale.set(0.55, 0.55, 1);
      glow.position.set(side * 0.34, 0.12, 0.75);
      this.head.add(glow);
      this.glows.push(glow);
      const light = new THREE.PointLight(0xff2010, 1.2, 1.2, 2);
      light.position.set(side * 0.34, 0.12, 0.8);
      this.head.add(light);
      this.eyeLights.push(light);
    }

    // Dents du haut sur un arc
    const toothGeometry = new THREE.ExtrudeGeometry(
      shape([
        [-0.045, 0],
        [0.045, 0],
        [0.045, -0.14],
        [0.03, -0.17],
        [-0.03, -0.17],
        [-0.045, -0.14],
      ]),
      {
        depth: 0.07,
        bevelEnabled: true,
        bevelThickness: 0.012,
        bevelSize: 0.01,
        bevelSegments: 3,
      },
    );
    const teethRow = (y, flip, parent, zBase) => {
      const count = 10;
      for (let i = 0; i < count; i += 1) {
        const t = (i - (count - 1) / 2) / ((count - 1) / 2);
        const angle = t * 0.62;
        const mesh = new THREE.Mesh(toothGeometry, tooth);
        const radius = 0.62;
        mesh.position.set(
          Math.sin(angle) * radius,
          y,
          zBase + Math.cos(angle) * radius - radius,
        );
        mesh.rotation.y = angle;
        if (flip) mesh.rotation.z = Math.PI;
        mesh.scale.y = 1 - Math.abs(t) * 0.25;
        parent.add(mesh);
      }
    };
    const maxilla = plate(
      [
        [-0.52, 0],
        [0.52, 0],
        [0.46, -0.1],
        [-0.46, -0.1],
      ],
      0.3,
      0.03,
      steel,
    );
    bend(maxilla, 0.55);
    maxilla.position.set(0, -0.54, 0.5);
    this.head.add(maxilla);
    // Dents du haut : de -0.64 à -0.81 (repère de la tête)
    teethRow(-0.64, false, this.head, 0.86);

    // Bouche : fond sombre entre les deux rangées, visible quand la mâchoire s'ouvre
    const mouth = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.45, 0.4),
      cavity,
    );
    mouth.position.set(0, -0.84, 0.5);
    this.head.add(mouth);

    // Mandibule sur charnière (pivot à -0.75) ; dents du bas de -0.98 à -0.81, fermée
    this.jawPivot = new THREE.Group();
    this.jawPivot.position.set(0, -0.75, 0.05);
    this.head.add(this.jawPivot);
    const mandible = plate(
      // Menton de crâne : large aux charnières, étroit et anguleux devant
      [
        [-0.56, 0.02],
        [0.56, 0.02],
        [0.58, -0.14],
        [0.36, -0.36],
        [0.16, -0.46],
        [-0.16, -0.46],
        [-0.36, -0.36],
        [-0.58, -0.14],
      ],
      0.26,
      0.05,
      chrome,
    );
    bend(mandible, 0.6);
    mandible.position.set(0, -0.22, 0.44);
    this.jawPivot.add(mandible);
    teethRow(-0.23, true, this.jawPivot, 0.81);
    for (const side of [-1, 1]) {
      const hinge = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.11, 0.18, 32),
        steel,
      );
      hinge.rotation.z = Math.PI / 2;
      hinge.position.set(side * 0.68, 0, 0.35);
      this.jawPivot.add(hinge);
    }

    // Vérins des tempes : corps fixe, tige qui suit la mâchoire
    this.pistons = [-1, 1].map((side) => {
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.075, 0.075, 1, 24),
        darkSteel,
      );
      const rod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 1, 24),
        chrome,
      );
      this.head.add(body, rod);
      return {
        side,
        body,
        rod,
        top: new THREE.Vector3(side * 0.82, 0.35, 0.2),
      };
    });

    // Cou : vertèbres, vérins et câbles
    const neck = new THREE.Group();
    neck.position.set(0, -1.5, -0.1);
    this.head.add(neck);
    for (let i = 0; i < 5; i += 1) {
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2 - i * 0.008, 0.2 - i * 0.008, 0.09, 32),
        i % 2 ? darkSteel : steel,
      );
      disc.position.y = -i * 0.14;
      neck.add(disc);
    }
    for (const side of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.34, 0.25, 0.05),
        new THREE.Vector3(side * 0.3, -0.2, 0.12),
        new THREE.Vector3(side * 0.24, -0.75, 0.05),
      ]);
      neck.add(
        new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.035, 12), rubber),
      );
      const piston = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.9, 20),
        chrome,
      );
      piston.position.set(side * 0.3, -0.2, -0.3);
      piston.rotation.z = side * 0.12;
      piston.scale.y = 0.7;
      neck.add(piston);
    }
  }

  lights() {
    this.key = new THREE.DirectionalLight(0xfff4e8, 2.2);
    this.key.position.set(-3, 4, 5);
    this.rim = new THREE.DirectionalLight(0x6f9bff, 2.4);
    this.rim.position.set(3, 2, -4);
    this.fill = new THREE.HemisphereLight(0xb8c8ff, 0x101218, 0.5);
    this.scene.add(this.key, this.rim, this.fill);
  }

  setState(state) {
    this.state = MOTION[state] ? state : "idle";
  }

  setLevel(level) {
    this.target.level = Math.max(0, Math.min(1, level));
  }

  // Nuance du domaine : couleur de la lumière de contre-jour
  setHue(shift) {
    this.rim.color.setHSL(((BASE_HUE + shift) % 360) / 360, 0.85, 0.62);
  }

  setTheme(theme) {
    this.renderer.toneMappingExposure = theme === "light" ? 1.15 : 1.05;
  }

  stop() {
    this.stopped = true;
    this.observer.disconnect();
    this.scene.traverse((node) => node.geometry?.dispose());
    for (const material of this.materials) material.dispose();
    this.renderer.dispose();
  }

  resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Garder la tête entière quand le cadre est étroit
    this.camera.fov = width < height ? 28 * (height / width) * 0.9 : 28;
    this.camera.updateProjectionMatrix();
  }

  updatePistons() {
    const end = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const { side, body, rod, top } of this.pistons) {
      end.set(side * 0.7, -0.3, 0.3);
      this.jawPivot.localToWorld(end);
      this.head.worldToLocal(end);
      const direction = end.clone().sub(top);
      const length = direction.length();
      const quaternion = new THREE.Quaternion().setFromUnitVectors(
        up,
        direction.clone().normalize(),
      );
      body.quaternion.copy(quaternion);
      body.scale.set(1, length * 0.55, 1);
      body.position.copy(top).addScaledVector(direction, 0.275);
      rod.quaternion.copy(quaternion);
      rod.scale.set(1, length * 0.6, 1);
      rod.position.copy(top).addScaledVector(direction, 0.7);
    }
  }

  frame(now) {
    if (this.stopped) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const slow = this.reducedMotion ? 0.25 : 1;
    const motion = MOTION[this.state];
    const ease = 1 - Math.exp(-dt * 4);
    this.time += dt * slow;
    this.eyes = lerp(this.eyes, motion.eyes, ease);
    const attack = this.target.level > this.level ? 20 : 6;
    this.level = lerp(
      this.level,
      this.target.level,
      1 - Math.exp(-dt * attack),
    );
    const open = this.state === "speaking" ? Math.min(1, this.level * 1.6) : 0;
    this.jaw = lerp(
      this.jaw,
      open,
      1 - Math.exp(-dt * (open > this.jaw ? 25 : 10)),
    );

    const t = this.time;
    this.head.rotation.y = Math.sin(t * 0.35) * 0.22 * motion.sway;
    this.head.rotation.x =
      motion.nod +
      Math.sin(t * 0.5) * 0.03 * motion.sway +
      (this.state === "user" ? this.level * 0.06 : 0);
    this.head.position.y = Math.sin(t * 1.3) * 0.02;
    this.jawPivot.rotation.x = this.jaw * 0.38;
    this.updatePistons();

    const pulse = this.state === "thinking" ? 0.7 + 0.3 * Math.sin(t * 8) : 1;
    const eyes = this.eyes * pulse;
    this.eyeMaterial.emissiveIntensity = 1 + eyes * 4;
    for (const glow of this.glows) glow.material.opacity = 0.25 + eyes * 0.75;
    for (const light of this.eyeLights) light.intensity = 0.4 + eyes * 1.6;

    // 30 images/s suffisent : le GPU est partagé avec la voix et le LLM
    if (now - (this.rendered ?? 0) >= 1000 / 30) {
      this.rendered = now;
      this.renderer.render(this.scene, this.camera);
    }
    requestAnimationFrame((next) => this.frame(next));
  }
}
