// Tête de cyborg (canvas 2D), alternative à l'orbe : même interface (setState,
// setLevel, setHue, setTheme, stop). Création originale : crâne métallique, yeux
// rouges, mâchoire articulée qui s'ouvre au rythme de la voix.

const MOTION = {
  idle: { eyes: 0.35, bob: 1, scan: 0 },
  connecting: { eyes: 0.6, bob: 1, scan: 1 },
  listening: { eyes: 0.75, bob: 0.6, scan: 0 },
  user: { eyes: 0.85, bob: 0.4, scan: 0 },
  thinking: { eyes: 0.9, bob: 0.3, scan: 1 },
  speaking: { eyes: 1, bob: 0.5, scan: 0 },
};

const lerp = (a, b, t) => a + (b - a) * t;

export class Face {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.state = "idle";
    this.target = { level: 0 };
    this.level = 0;
    this.jaw = 0;
    this.time = 0;
    this.eyes = MOTION.idle.eyes;
    this.scan = 0;
    this.hueShift = 0;
    this.light = false;
    this.stopped = false;
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    this.last = performance.now();
    requestAnimationFrame((now) => this.frame(now));
  }

  setState(state) {
    this.state = MOTION[state] ? state : "idle";
  }

  setLevel(level) {
    this.target.level = Math.max(0, Math.min(1, level));
  }

  setHue(shift) {
    this.hueShift = shift;
  }

  setTheme(theme) {
    this.light = theme === "light";
  }

  stop() {
    this.stopped = true;
    this.observer.disconnect();
  }

  resize() {
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
  }

  frame(now) {
    if (this.stopped) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const motion = MOTION[this.state];
    const ease = 1 - Math.exp(-dt * 4);
    this.eyes = lerp(this.eyes, motion.eyes, ease);
    this.scan = lerp(this.scan, motion.scan, ease);
    const attack = this.target.level > this.level ? 20 : 6;
    this.level = lerp(
      this.level,
      this.target.level,
      1 - Math.exp(-dt * attack),
    );
    // Mâchoire : suit la voix de l'assistant seulement, avec une ouverture minimale
    const open = this.state === "speaking" ? Math.min(1, this.level * 1.6) : 0;
    this.jaw = lerp(
      this.jaw,
      open,
      1 - Math.exp(-dt * (open > this.jaw ? 25 : 10)),
    );
    this.time += dt * (this.reducedMotion ? 0.25 : 1);
    this.draw();
    requestAnimationFrame((next) => this.frame(next));
  }

  metal(ctx, x0, y0, x1, y1, bright = 1) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    const k = this.light ? 0.92 : 1;
    const shade = (l) => `hsl(215 8% ${Math.round(l * k * bright)}%)`;
    g.addColorStop(0, shade(86));
    g.addColorStop(0.35, shade(62));
    g.addColorStop(0.7, shade(38));
    g.addColorStop(1, shade(22));
    return g;
  }

  draw() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    const s = Math.min(w, h) * 0.9;
    const motion = MOTION[this.state];
    const bob = Math.sin(this.time * 1.4) * s * 0.004 * motion.bob;
    const tilt =
      (this.state === "user" ? Math.sin(this.time * 3) * 0.02 : 0) +
      Math.sin(this.time * 0.6) * 0.008;
    const cx = w / 2;
    const cy = h / 2 + s * 0.02 + bob;
    const dark = "hsl(215 22% 7%)";
    const edge = this.light ? "hsl(215 20% 20%)" : "hsl(215 25% 6%)";
    const P = (x, y) => [x * s, y * s];

    ctx.clearRect(0, 0, w, h);

    // Halo d'ambiance, teinté selon le domaine de l'agent
    const hue = 222 + this.hueShift;
    const halo = ctx.createRadialGradient(cx, cy, s * 0.08, cx, cy, s * 0.55);
    halo.addColorStop(
      0,
      `hsl(${hue} 90% ${this.light ? 72 : 50}% / ${0.25 + this.eyes * 0.12})`,
    );
    halo.addColorStop(1, `hsl(${hue} 90% 50% / 0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const thin = Math.max(1, s * 0.0035);
    const drop = this.jaw * s * 0.075;

    const path = (points) => {
      ctx.beginPath();
      points.forEach(([x, y], i) =>
        i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s),
      );
      ctx.closePath();
    };
    const plate = (fill) => {
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = thin;
      ctx.strokeStyle = edge;
      ctx.stroke();
    };

    // Cou : vertèbres et vérins hydrauliques
    for (let i = 0; i < 5; i += 1) {
      const y = 0.3 + i * 0.045;
      ctx.beginPath();
      ctx.roundRect(
        ...P(-0.045 + i * 0.002, y),
        0.09 * s - i * 0.004 * s,
        0.032 * s,
        s * 0.008,
      );
      plate(this.metal(ctx, -0.05 * s, y * s, 0.05 * s, (y + 0.03) * s, 0.85));
    }
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(...P(side * 0.13, 0.27));
      ctx.lineTo(...P(side * 0.09, 0.52));
      ctx.lineWidth = s * 0.026;
      ctx.strokeStyle = this.metal(ctx, 0, 0.27 * s, 0, 0.52 * s, 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(...P(side * 0.125, 0.36));
      ctx.lineTo(...P(side * 0.095, 0.5));
      ctx.lineWidth = s * 0.01;
      ctx.strokeStyle = this.light ? "hsl(215 10% 75%)" : "hsl(215 10% 82%)";
      ctx.stroke();
    }

    // Cavité buccale (visible quand la mâchoire s'ouvre)
    ctx.beginPath();
    ctx.roundRect(...P(-0.13, 0.15), 0.26 * s, 0.075 * s + drop, s * 0.01);
    ctx.fillStyle = dark;
    ctx.fill();

    // Vérins des tempes jusqu'aux angles de la mâchoire
    for (const side of [-1, 1]) {
      const [tx, ty] = P(side * 0.245, -0.02);
      const [bx, by] = [side * 0.2 * s, 0.245 * s + drop];
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(bx, by);
      ctx.lineWidth = s * 0.034;
      ctx.strokeStyle = this.metal(ctx, tx, ty, bx, by, 0.75);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tx + side * s * 0.004, ty + s * 0.09);
      ctx.lineTo(bx, by);
      ctx.lineWidth = s * 0.012;
      ctx.strokeStyle = this.light ? "hsl(215 10% 78%)" : "hsl(215 12% 85%)";
      ctx.stroke();
    }

    // Mâchoire inférieure : dents et mandibule, descend avec la voix
    ctx.save();
    ctx.translate(0, drop);
    path([
      [-0.2, 0.225],
      [0.2, 0.225],
      [0.205, 0.262],
      [0.1, 0.33],
      [-0.1, 0.33],
      [-0.205, 0.262],
    ]);
    plate(this.metal(ctx, -0.2 * s, 0.22 * s, 0.12 * s, 0.34 * s));
    ctx.beginPath();
    ctx.moveTo(...P(-0.07, 0.3));
    ctx.lineTo(...P(0.07, 0.3));
    ctx.lineWidth = s * 0.006;
    ctx.strokeStyle = this.light ? "hsl(215 12% 40%)" : "hsl(215 12% 25%)";
    ctx.stroke();
    // Dents du bas : dépassent de la mandibule et touchent celles du haut, bouche fermée
    this.teeth(ctx, s, 0.188, 1);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(side * 0.2 * s, 0.245 * s, s * 0.022, 0, Math.PI * 2);
      plate(
        this.metal(ctx, side * 0.18 * s, 0.22 * s, side * 0.22 * s, 0.27 * s),
      );
    }
    ctx.restore();

    // Crâne : boîte crânienne, tempes, pommettes jusqu'au maxillaire
    path([
      [-0.16, 0.15],
      [-0.215, 0.12],
      [-0.245, 0.06],
      [-0.262, -0.03],
      [-0.29, -0.14],
      [-0.3, -0.25],
      [-0.26, -0.36],
      [-0.17, -0.43],
      [0, -0.46],
      [0.17, -0.43],
      [0.26, -0.36],
      [0.3, -0.25],
      [0.29, -0.14],
      [0.262, -0.03],
      [0.245, 0.06],
      [0.215, 0.12],
      [0.16, 0.15],
    ]);
    plate(this.metal(ctx, -0.25 * s, -0.46 * s, 0.25 * s, 0.15 * s));

    // Reflet et jointures des plaques
    const shine = ctx.createRadialGradient(
      -0.09 * s,
      -0.33 * s,
      0,
      -0.09 * s,
      -0.33 * s,
      s * 0.17,
    );
    shine.addColorStop(0, "rgba(255,255,255,0.5)");
    shine.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = shine;
    ctx.beginPath();
    ctx.ellipse(
      -0.08 * s,
      -0.32 * s,
      s * 0.15,
      s * 0.07,
      -0.35,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.lineWidth = s * 0.004;
    ctx.strokeStyle = this.light ? "hsl(215 12% 42%)" : "hsl(215 12% 28%)";
    for (const seam of [
      [
        [0, -0.46],
        [0, -0.2],
      ],
      [
        [-0.27, -0.2],
        [-0.14, -0.22],
        [-0.05, -0.3],
      ],
      [
        [0.27, -0.2],
        [0.14, -0.22],
        [0.05, -0.3],
      ],
    ]) {
      ctx.beginPath();
      seam.forEach(([x, y], i) =>
        i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s),
      );
      ctx.stroke();
    }

    // Pommettes
    for (const side of [-1, 1]) {
      path([
        [side * 0.235, 0.0],
        [side * 0.2, 0.07],
        [side * 0.12, 0.1],
        [side * 0.07, 0.06],
        [side * 0.1, 0.03],
        [side * 0.2, 0.02],
      ]);
      plate(
        this.metal(ctx, side * 0.24 * s, 0, side * 0.08 * s, 0.1 * s, 0.85),
      );
    }

    // Orbites profondes et yeux
    for (const side of [-1, 1]) {
      const ex = side * 0.118 * s;
      const ey = -0.035 * s;
      path([
        [side * 0.04, -0.07],
        [side * 0.2, -0.075],
        [side * 0.215, -0.03],
        [side * 0.185, 0.015],
        [side * 0.06, 0.012],
        [side * 0.035, -0.02],
      ]);
      ctx.fillStyle = dark;
      ctx.fill();
      ctx.lineWidth = thin;
      ctx.strokeStyle = edge;
      ctx.stroke();
      const flicker =
        this.state === "thinking"
          ? 0.7 + 0.3 * Math.sin(this.time * 9 + side)
          : 1;
      const intensity = this.eyes * flicker;
      ctx.save();
      ctx.shadowColor = `rgba(255, 30, 20, ${intensity})`;
      ctx.shadowBlur = s * 0.07 * intensity;
      const glow = ctx.createRadialGradient(ex, ey, 0, ex, ey, s * 0.06);
      glow.addColorStop(0, `rgba(255, 90, 60, ${intensity})`);
      glow.addColorStop(0.4, `rgba(235, 20, 15, ${0.8 * intensity})`);
      glow.addColorStop(1, "rgba(180, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(ex, ey, s * 0.055, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(ex, ey, s * (0.01 + 0.006 * intensity), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 240, 225, ${0.55 + 0.45 * intensity})`;
      ctx.fill();
    }

    // Arcade sourcilière (surplombe les orbites)
    path([
      [-0.255, -0.1],
      [-0.12, -0.115],
      [-0.03, -0.095],
      [0, -0.075],
      [0.03, -0.095],
      [0.12, -0.115],
      [0.255, -0.1],
      [0.25, -0.072],
      [0.12, -0.082],
      [0.03, -0.068],
      [0, -0.05],
      [-0.03, -0.068],
      [-0.12, -0.082],
      [-0.25, -0.072],
    ]);
    plate(this.metal(ctx, 0, -0.12 * s, 0, -0.05 * s, 0.7));

    // Cavité nasale
    path([
      [-0.04, 0.035],
      [0, 0.02],
      [0.04, 0.035],
      [0.022, 0.1],
      [-0.022, 0.1],
    ]);
    ctx.fillStyle = dark;
    ctx.fill();

    // Maxillaire et dents du haut
    path([
      [-0.17, 0.105],
      [0.17, 0.105],
      [0.155, 0.15],
      [-0.155, 0.15],
    ]);
    plate(this.metal(ctx, -0.17 * s, 0.1 * s, 0.17 * s, 0.15 * s, 0.9));
    this.teeth(ctx, s, 0.15, -1);

    // Balayage lumineux (réflexion, connexion)
    if (this.scan > 0.02) {
      const y = -0.45 * s + ((this.time * 0.5) % 1) * s * 0.8;
      const band = ctx.createLinearGradient(0, y - s * 0.03, 0, y + s * 0.03);
      band.addColorStop(0, "rgba(255, 40, 40, 0)");
      band.addColorStop(0.5, `rgba(255, 40, 40, ${0.3 * this.scan})`);
      band.addColorStop(1, "rgba(255, 40, 40, 0)");
      ctx.fillStyle = band;
      ctx.fillRect(-0.32 * s, y - s * 0.03, s * 0.64, s * 0.06);
    }
    ctx.restore();
  }

  // Rangée de dents : `dir` = -1 (haut, vers le bas depuis y) ou 1 (bas, depuis y)
  teeth(ctx, s, y, dir) {
    const count = 8;
    const width = 0.034 * s;
    const gap = 0.004 * s;
    const height = 0.042 * s;
    const start = -((count * width + (count - 1) * gap) / 2);
    for (let i = 0; i < count; i += 1) {
      const x = start + i * (width + gap);
      // Dents du fond plus courtes : effet de courbure de l'arcade
      const depth = 1 - Math.abs(i - (count - 1) / 2) / count;
      const tall = height * (0.8 + 0.2 * depth);
      const top = dir < 0 ? y * s : y * s + (height - tall);
      ctx.beginPath();
      ctx.roundRect(x, top, width, tall, s * 0.006);
      const g = ctx.createLinearGradient(x, top, x + width, top);
      g.addColorStop(0, this.light ? "hsl(40 12% 80%)" : "hsl(40 10% 72%)");
      g.addColorStop(0.5, this.light ? "hsl(40 15% 94%)" : "hsl(40 12% 90%)");
      g.addColorStop(1, this.light ? "hsl(40 10% 74%)" : "hsl(40 8% 62%)");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = Math.max(1, s * 0.003);
      ctx.strokeStyle = "hsl(215 15% 22%)";
      ctx.stroke();
    }
  }
}
