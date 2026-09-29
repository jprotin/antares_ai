// Bender : robot en volumes simples (tête-cylindre à dôme et antenne, visière aux yeux
// ronds à pupilles carrées, grille de dents, torse conique à porte, bras annelés),
// canette de bière rouge générique dans une main, cigare fumant dans l'autre.
// Cadrage buste. La grille de dents s'ouvre au rythme de la voix ; gorgées de bière et
// bouffées de cigare au repos.

import { Avatar3DBase, lerp } from "./base.js";

const METAL = 0xa7b6c6;
const GROOVE = 0x6f7c8a;

function smokeTexture(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(235,238,242,0.7)");
  g.addColorStop(1, "rgba(235,238,242,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export class Bender extends Avatar3DBase {
  constructor(canvas) {
    super(canvas, { camera: [0, 1.3, 8.4], target: [0, 1.15, 0], fov: 30 });
    this.gaze = { x: 0, y: 0, tx: 0, ty: 0, next: 1 };
    this.blinkAt = 3;
    this.open = 0;
    this.drink = { start: 8, value: 0 };
    this.puff = { start: 4, value: 0 };
  }

  build(THREE) {
    this.THREE = THREE;
    const metal = this.material({
      color: METAL,
      metalness: 0.55,
      roughness: 0.36,
    });
    this.metal = metal;
    const groove = this.material({
      color: GROOVE,
      metalness: 0.5,
      roughness: 0.45,
    });
    this.groove = groove;
    const dark = this.material({
      color: 0x1a1f26,
      metalness: 0.3,
      roughness: 0.6,
    });
    const teeth = this.material({ color: 0xefe2b3, roughness: 0.45 });
    this.eyeMaterial = this.material({
      color: 0xf6ecc0,
      emissive: 0x6b5a1a,
      emissiveIntensity: 0.35,
      roughness: 0.3,
    });
    const pupil = this.material({ color: 0x0b0c0e, roughness: 0.5 });

    this.body = new THREE.Group();
    this.scene.add(this.body);
    this.head = new THREE.Group();
    this.head.position.y = 1.02;
    this.body.add(this.head);

    // Tête : cylindre, dôme, antenne
    const skull = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 1.0, 64),
      metal,
    );
    skull.position.y = 0.52;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2),
      metal,
    );
    dome.position.y = 1.02;
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.11, 0.1, 24),
      metal,
    );
    base.position.y = 1.6;
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.42, 12),
      metal,
    );
    rod.position.y = 1.85;
    this.antennaBall = this.material({
      color: METAL,
      emissive: 0xff5a1a,
      emissiveIntensity: 0,
      metalness: 0.5,
      roughness: 0.35,
    });
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.065, 24, 16),
      this.antennaBall,
    );
    ball.position.y = 2.08;
    this.antenna = new THREE.Group();
    this.antenna.add(rod, ball);
    this.head.add(skull, dome, base, this.antenna);

    // Visière : ovale allongé en relief, intérieur sombre, yeux et pupilles carrées
    const stadium = (w, h) => {
      const r = h / 2;
      const s = new THREE.Shape();
      s.moveTo(-w / 2 + r, -r);
      s.lineTo(w / 2 - r, -r);
      s.absarc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
      s.lineTo(-w / 2 + r, r);
      s.absarc(-w / 2 + r, 0, r, Math.PI / 2, (Math.PI * 3) / 2, false);
      return s;
    };
    const rim = stadium(1.02, 0.4);
    rim.holes.push(new THREE.Path(stadium(0.9, 0.3).getPoints(48)));
    const visor = new THREE.Mesh(
      new THREE.ExtrudeGeometry(rim, {
        depth: 0.3,
        bevelEnabled: true,
        bevelThickness: 0.03,
        bevelSize: 0.03,
        bevelSegments: 4,
        curveSegments: 32,
      }),
      metal,
    );
    visor.position.set(0, 0.72, 0.36);
    const inside = new THREE.Mesh(
      new THREE.ShapeGeometry(stadium(0.9, 0.3), 32),
      dark,
    );
    inside.position.set(0, 0.72, 0.42);
    this.head.add(visor, inside);
    this.eyes = [];
    this.pupils = [];
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.135, 32, 24),
        this.eyeMaterial,
      );
      eye.position.set(side * 0.2, 0.72, 0.5);
      eye.scale.z = 0.7;
      const dot = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.06, 0.02),
        pupil,
      );
      dot.position.set(side * 0.2, 0.72, 0.6);
      this.head.add(eye, dot);
      this.eyes.push(eye);
      this.pupils.push({ dot, x: side * 0.2 });
    }

    // Bouche : cadre, cavité sombre, deux rangées de dents
    const frame = new THREE.Mesh(
      new THREE.ExtrudeGeometry(
        (() => {
          const s = new THREE.Shape();
          const w = 0.34;
          const h = 0.18;
          s.moveTo(-w, -h);
          s.lineTo(w, -h);
          s.lineTo(w, h);
          s.lineTo(-w, h);
          s.holes.push(
            new THREE.Path([
              new THREE.Vector2(-w + 0.04, -h + 0.03),
              new THREE.Vector2(w - 0.04, -h + 0.03),
              new THREE.Vector2(w - 0.04, h - 0.03),
              new THREE.Vector2(-w + 0.04, h - 0.03),
            ]),
          );
          return s;
        })(),
        {
          depth: 0.08,
          bevelEnabled: true,
          bevelThickness: 0.02,
          bevelSize: 0.02,
          bevelSegments: 3,
        },
      ),
      metal,
    );
    frame.position.set(0, 0.3, 0.53);
    // Fond de bouche noir mat : un matériau réfléchissant y montrait un reflet gris
    const voidMaterial = new THREE.MeshBasicMaterial({ color: 0x07080a });
    this.materials.push(voidMaterial);
    const cavity = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.3, 0.05),
      voidMaterial,
    );
    // Devant la courbure du cylindre de la tête (rayon 0,55) sur toute sa largeur
    cavity.position.set(0, 0.3, 0.565);
    this.head.add(frame, cavity);
    this.upperTeeth = new THREE.Group();
    this.lowerTeeth = new THREE.Group();
    for (const [row, y] of [
      [this.upperTeeth, 0.07],
      [this.lowerTeeth, -0.07],
    ]) {
      for (let c = 0; c < 5; c += 1) {
        const tooth = new THREE.Mesh(
          new THREE.BoxGeometry(0.11, 0.12, 0.05),
          teeth,
        );
        tooth.position.set((c - 2) * 0.118, y, 0);
        row.add(tooth);
      }
      row.position.set(0, 0.3, 0.605);
      this.head.add(row);
    }

    // Collerette et cou
    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.05, 16, 48),
      metal,
    );
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.02;
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.46, 0.5, 0.14, 48),
      groove,
    );
    neck.position.y = -0.02;
    this.head.add(collar, neck);

    // Torse : profil de révolution (épaules arrondies, évasé vers le bas)
    const profile = [
      [0, 0.95],
      [0.55, 0.95],
      [0.7, 0.92],
      [0.77, 0.84],
      [0.8, 0.7],
      [0.9, -0.3],
      [0.95, -0.7],
      [0, -0.7],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const torso = new THREE.Mesh(new THREE.LatheGeometry(profile, 72), metal);
    this.body.add(torso);
    // Porte ventrale : panneau épousant le torse, et sa poignée
    const door = new THREE.Mesh(
      new THREE.CylinderGeometry(0.885, 0.925, 0.95, 48, 1, true, -0.45, 0.9),
      this.material({
        color: 0x9aa9ba,
        metalness: 0.5,
        roughness: 0.4,
        side: THREE.DoubleSide,
      }),
    );
    door.position.y = 0.05;
    door.scale.set(1.01, 1, 1.01);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), metal);
    knob.position.set(0.36, 0.05, 0.84);
    this.body.add(door, knob);

    // Bras annelés et mains
    this.arms = {};
    const armCurve = (points) =>
      new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    const makeArm = (key, points) => {
      const curve = armCurve(points);
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 40, 0.12, 20),
        metal,
      );
      const rings = new THREE.Group();
      this.body.add(tube, rings);
      this.arms[key] = { tube, rings, points };
      this.updateArm(key, points);
    };
    // Main droite (à gauche de l'écran) : canette ; main gauche : cigare
    this.canRest = [
      [-0.78, 0.72, 0],
      [-1.12, 0.1, 0.2],
      [-0.95, -0.15, 0.62],
    ];
    this.canDrink = [
      [-0.78, 0.72, 0],
      [-1.05, 0.55, 0.45],
      [-0.32, 1.25, 0.72],
    ];
    makeArm("right", this.canRest);
    makeArm("left", [
      [0.78, 0.72, 0],
      [1.18, 0.15, 0.2],
      [0.95, 0.35, 0.62],
    ]);

    const hand = (material) => {
      const group = new THREE.Group();
      const palm = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 24, 16),
        material,
      );
      palm.scale.set(1, 0.9, 0.8);
      group.add(palm);
      for (let f = 0; f < 3; f += 1) {
        const finger = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.045, 0.12, 6, 12),
          material,
        );
        finger.position.set(0.1, 0.07 - f * 0.07, 0.07);
        finger.rotation.z = Math.PI / 2;
        group.add(finger);
      }
      return group;
    };

    // Canette de bière rouge (générique, sans marque)
    this.canHand = hand(metal);
    const can = new THREE.Group();
    const red = this.material({
      color: 0xc8232c,
      metalness: 0.65,
      roughness: 0.3,
    });
    const silver = this.material({
      color: 0xdfe3e8,
      metalness: 1,
      roughness: 0.25,
    });
    const white = this.material({
      color: 0xf4f4f2,
      metalness: 0.3,
      roughness: 0.4,
    });
    const bodyCan = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.34, 32),
      red,
    );
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1305, 0.1305, 0.07, 32),
      white,
    );
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.13, 0.04, 32),
      silver,
    );
    top.position.y = 0.19;
    const bottom = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.11, 0.03, 32),
      silver,
    );
    bottom.position.y = -0.185;
    can.add(bodyCan, band, top, bottom);
    can.position.set(0.1, 0.05, 0.02);
    this.canHand.add(can);
    this.body.add(this.canHand);

    // Cigare, bout rougeoyant et fumée
    this.cigarHand = hand(metal);
    this.cigarHand.rotation.y = Math.PI;
    const cigar = new THREE.Group();
    const leaf = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.06, 0.7, 20),
      this.material({ color: 0x7a4b2a, roughness: 0.8 }),
    );
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(0.062, 0.062, 0.06, 20),
      this.material({ color: 0xc9a13a, metalness: 0.4, roughness: 0.4 }),
    );
    ring.position.y = -0.18;
    this.ember = this.material({
      color: 0x3a1a0a,
      emissive: 0xff5a14,
      emissiveIntensity: 1.2,
    });
    const tip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.056, 0.055, 0.05, 20),
      this.ember,
    );
    tip.position.y = 0.37;
    cigar.add(leaf, ring, tip);
    cigar.rotation.z = -1.2;
    cigar.rotation.y = 0.5;
    cigar.position.set(0.05, 0.02, 0.1);
    this.tip = tip;
    this.cigarHand.add(cigar);
    this.body.add(this.cigarHand);
    this.emberLight = new THREE.PointLight(0xff6a1a, 0.6, 1.2, 2);
    this.scene.add(this.emberLight);
    this.smoke = [];
    const smokeMap = smokeTexture(THREE);
    for (let i = 0; i < 14; i += 1) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: smokeMap,
          transparent: true,
          depthWrite: false,
          opacity: 0,
        }),
      );
      this.scene.add(sprite);
      this.smoke.push({ sprite, age: i / 14 });
    }

    this.rim.intensity = 1.6;
  }

  // Reconstruit un bras (tube + anneaux) le long de ses points de passage
  updateArm(key, points) {
    const THREE = this.THREE;
    const arm = this.arms[key];
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(...p)),
    );
    arm.tube.geometry.dispose();
    arm.tube.geometry = new THREE.TubeGeometry(curve, 40, 0.12, 20);
    for (const ring of arm.rings.children) ring.geometry.dispose();
    arm.rings.clear();
    for (let i = 1; i < 9; i += 1) {
      const t = i / 9;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.122, 0.012, 8, 24),
        this.groove,
      );
      ring.position.copy(curve.getPointAt(t));
      ring.lookAt(curve.getPointAt(Math.min(1, t + 0.01)));
      arm.rings.add(ring);
    }
    arm.end = curve.getPointAt(1);
  }

  animate(dt, t) {
    const THREE = this.THREE;
    // Bouche : les rangées de dents s'écartent avec la voix
    const target =
      this.state === "speaking" ? Math.min(1, this.level * 1.6) : 0;
    this.open = lerp(
      this.open,
      target,
      1 - Math.exp(-dt * (target > this.open ? 22 : 10)),
    );
    // Chaque rangée se tasse contre son bord (haut / bas) : la bouche sombre s'ouvre
    // au milieu, les dents restent visibles dans le cadre
    const squash = 1 - this.open * 0.55;
    for (const [row, sign] of [
      [this.upperTeeth, 1],
      [this.lowerTeeth, -1],
    ]) {
      row.scale.y = squash;
      row.position.y = 0.3 + sign * 0.13 * (1 - squash);
    }

    // Regard (pupilles carrées) : vers toi à l'écoute, en l'air en réflexion
    const g = this.gaze;
    if (t > g.next) {
      const attentive = this.state === "user" || this.state === "listening";
      g.tx =
        this.state === "thinking"
          ? 0.05
          : attentive
            ? 0
            : (Math.random() - 0.5) * 0.12;
      g.ty =
        this.state === "thinking"
          ? 0.07
          : attentive
            ? 0
            : (Math.random() - 0.5) * 0.06;
      g.next = t + 0.7 + Math.random() * 2;
    }
    g.x = lerp(g.x, g.tx, 1 - Math.exp(-dt * 12));
    g.y = lerp(g.y, g.ty, 1 - Math.exp(-dt * 12));
    for (const { dot, x } of this.pupils)
      dot.position.set(x + g.x, 0.72 + g.y, 0.6);

    // Clignement : les yeux s'écrasent un instant
    let closed = 0;
    if (t > this.blinkAt) {
      const k = (t - this.blinkAt) / 0.14;
      closed = k < 1 ? Math.sin(k * Math.PI) : 0;
      if (k >= 1) this.blinkAt = t + 2.5 + Math.random() * 3;
    }
    for (const eye of this.eyes) eye.scale.y = 1 - closed * 0.9;
    for (const { dot } of this.pupils) dot.visible = closed < 0.5;

    // Antenne : oscille, la boule clignote en réflexion
    this.antenna.rotation.z = Math.sin(t * 2.3) * 0.05 + this.open * 0.05;
    this.antennaBall.emissiveIntensity =
      this.state === "thinking" ? (Math.sin(t * 8) > 0 ? 1.4 : 0.1) : 0;

    // Gorgée de bière de temps en temps (pas pendant qu'il parle)
    const d = this.drink;
    if (t > d.start && this.state !== "speaking") {
      const k = (t - d.start) / 2.6;
      d.value = k < 1 ? Math.sin(k * Math.PI) : 0;
      if (k >= 1) d.start = t + 12 + Math.random() * 10;
    } else if (this.state === "speaking") {
      d.value = lerp(d.value, 0, 1 - Math.exp(-dt * 6));
    }
    // Le bras n'est reconstruit que lorsqu'il bouge
    if (Math.abs(d.value - (this.armValue ?? -1)) > 0.004) {
      this.armValue = d.value;
      const arm = this.canRest.map((p, i) =>
        p.map((v, j) => lerp(v, this.canDrink[i][j], d.value)),
      );
      this.updateArm("right", arm);
    }
    this.canHand.position.copy(this.arms.right.end);
    this.canHand.rotation.z = d.value * 1.1;
    this.cigarHand.position.copy(this.arms.left.end);

    // Cigare : bouffées (le bout s'illumine), fumée qui monte
    const p = this.puff;
    if (t > p.start) {
      const k = (t - p.start) / 1.2;
      p.value = k < 1 ? Math.sin(k * Math.PI) : 0;
      if (k >= 1) p.start = t + 5 + Math.random() * 5;
    }
    this.ember.emissiveIntensity = 1 + p.value * 3 + Math.sin(t * 13) * 0.15;
    const tipWorld = new THREE.Vector3();
    this.tip.getWorldPosition(tipWorld);
    this.emberLight.position.copy(tipWorld);
    this.emberLight.intensity = 0.4 + p.value * 1.2;
    for (const puff of this.smoke) {
      puff.age += dt * 0.35;
      if (puff.age > 1) puff.age -= 1;
      const a = puff.age;
      puff.sprite.position.set(
        tipWorld.x + Math.sin(a * 6 + puff.age) * 0.08 + a * 0.15,
        tipWorld.y + a * 1.1,
        tipWorld.z,
      );
      const size = 0.12 + a * 0.45;
      puff.sprite.scale.set(size, size, 1);
      puff.sprite.material.opacity = (1 - a) * (0.22 + p.value * 0.25);
    }

    // Corps et tête
    this.head.rotation.x =
      -d.value * 0.18 + Math.sin(t * 0.9) * 0.015 + this.open * 0.03;
    this.head.rotation.y = Math.sin(t * 0.4) * 0.12 + g.x * 1.2;
    this.head.rotation.z = Math.sin(t * 0.6) * 0.02;
    this.body.rotation.y = Math.sin(t * 0.25) * 0.08;
    this.body.position.y = Math.sin(t * 1.1) * 0.015;
  }
}
