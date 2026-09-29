// Orbe animé (canvas 2D) : nappes lumineuses déformées, halo et particules en orbite.
// L'état pilote couleurs et vitesse ; le niveau audio (0..1) pilote l'amplitude.
// La teinte suit le domaine de l'agent (décalage léger) et le thème clair assombrit
// les couleurs pour qu'elles restent lisibles sur fond clair.

const PALETTES = {
  idle: [
    [70, 90, 150],
    [40, 50, 95],
  ],
  connecting: [
    [90, 120, 200],
    [60, 70, 150],
  ],
  listening: [
    [64, 196, 200],
    [52, 110, 220],
  ],
  user: [
    [96, 150, 255],
    [70, 220, 230],
  ],
  thinking: [
    [150, 110, 255],
    [230, 100, 200],
  ],
  speaking: [
    [90, 225, 180],
    [80, 140, 255],
  ],
};

const MOTION = {
  idle: { speed: 0.25, wobble: 0.03, spin: 0.05, particles: 0.25 },
  connecting: { speed: 0.6, wobble: 0.05, spin: 0.2, particles: 0.5 },
  listening: { speed: 0.55, wobble: 0.05, spin: 0.12, particles: 0.55 },
  user: { speed: 0.9, wobble: 0.07, spin: 0.2, particles: 0.8 },
  thinking: { speed: 1.4, wobble: 0.08, spin: 0.9, particles: 1 },
  speaking: { speed: 1, wobble: 0.07, spin: 0.25, particles: 0.9 },
};

const LAYERS = [
  {
    radius: 1,
    alpha: 0.55,
    harmonics: [
      [3, 1, 0],
      [5, 0.5, 1.7],
      [2, 0.7, 4.1],
    ],
    turn: 1,
  },
  {
    radius: 0.86,
    alpha: 0.6,
    harmonics: [
      [4, 1, 2.2],
      [6, 0.4, 0.3],
      [3, 0.6, 5.2],
    ],
    turn: -1.3,
  },
  {
    radius: 0.7,
    alpha: 0.7,
    harmonics: [
      [2, 1, 3.3],
      [5, 0.6, 2.4],
      [7, 0.3, 0.9],
    ],
    turn: 0.8,
  },
];

const PARTICLE_COUNT = 70;
const POINTS = 96;

const lerp = (a, b, t) => a + (b - a) * t;

// Décale la teinte (degrés) d'une couleur RVB ; `light` : tons plus clairs et plus
// saturés, lisibles sur fond clair (les teintes sombres du thème sombre y paraissent grises)
function shade([r, g, b], hueShift, light) {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
  }
  h = (h * 60 + hueShift + 360) % 360;
  if (light) {
    l = 0.5 + l * 0.3;
    sat = Math.min(1, sat * 1.35);
  }
  const c = (1 - Math.abs(2 * l - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
}
const rgba = ([r, g, b], a) => `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${a})`;

export class Orb {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.state = "idle";
    this.target = { level: 0 };
    this.level = 0;
    this.time = 0;
    this.hueShift = 0;
    this.light = false;
    this.palettes = PALETTES;
    this.colors = PALETTES.idle.map((c) => [...c]);
    this.motion = { ...MOTION.idle };
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      angle: Math.random() * Math.PI * 2,
      orbit: 1.15 + Math.random() * 0.55,
      speed: (0.15 + Math.random() * 0.5) * (Math.random() < 0.5 ? -1 : 1),
      size: 0.6 + Math.random() * 1.6,
      phase: Math.random() * Math.PI * 2,
    }));
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.last = performance.now();
    requestAnimationFrame((now) => this.frame(now));
  }

  setState(state) {
    this.state = PALETTES[state] ? state : "idle";
  }

  // Décalage de teinte (degrés) par rapport à la palette de base
  setHue(shift) {
    this.hueShift = shift;
    this.recolor();
  }

  setTheme(theme) {
    this.light = theme === "light";
    this.recolor();
  }

  recolor() {
    this.palettes = Object.fromEntries(
      Object.entries(PALETTES).map(([state, colors]) => [
        state,
        colors.map((c) => shade(c, this.hueShift, this.light)),
      ]),
    );
  }

  setLevel(level) {
    this.target.level = Math.max(0, Math.min(1, level));
  }

  resize() {
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const slow = this.reducedMotion ? 0.25 : 1;

    const palette = this.palettes[this.state];
    const motion = MOTION[this.state];
    const ease = 1 - Math.exp(-dt * 3);
    this.colors.forEach((color, i) =>
      color.forEach((_, k) => {
        color[k] = lerp(color[k], palette[i][k], ease);
      }),
    );
    for (const key of Object.keys(motion))
      this.motion[key] = lerp(this.motion[key], motion[key], ease);
    const attack = this.target.level > this.level ? 18 : 5;
    this.level = lerp(
      this.level,
      this.target.level,
      1 - Math.exp(-dt * attack),
    );
    this.time += dt * this.motion.speed * slow * (1 + this.level * 1.5);

    this.draw(dt * slow);
    requestAnimationFrame((next) => this.frame(next));
  }

  draw(dt) {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const base = Math.min(w, h) * 0.27 * (1 + this.level * 0.18);
    const [c1, c2] = this.colors;

    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";

    const glow = ctx.createRadialGradient(
      cx,
      cy,
      base * 0.2,
      cx,
      cy,
      base * 2.1,
    );
    glow.addColorStop(0, rgba(c1, 0.35 + this.level * 0.3));
    glow.addColorStop(0.5, rgba(c2, 0.12));
    glow.addColorStop(1, rgba(c2, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = "lighter";
    LAYERS.forEach((layer, index) => {
      const radius = base * layer.radius;
      const wobble = this.motion.wobble + this.level * 0.14;
      const rotation = this.time * this.motion.spin * layer.turn;
      ctx.beginPath();
      for (let i = 0; i <= POINTS; i += 1) {
        const theta = (i / POINTS) * Math.PI * 2;
        let offset = 0;
        for (const [k, amp, phase] of layer.harmonics) {
          offset +=
            amp *
            Math.sin(k * theta + this.time * (1 + k * 0.35) + phase + index);
        }
        const r = radius * (1 + wobble * offset * 0.5);
        const x = cx + r * Math.cos(theta + rotation);
        const y = cy + r * Math.sin(theta + rotation);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const fill = ctx.createRadialGradient(
        cx - radius * 0.3,
        cy - radius * 0.35,
        0,
        cx,
        cy,
        radius * 1.2,
      );
      fill.addColorStop(0, rgba(index % 2 ? c2 : c1, layer.alpha));
      fill.addColorStop(0.4, rgba(index % 2 ? c2 : c1, layer.alpha * 0.85));
      fill.addColorStop(1, rgba(index % 2 ? c1 : c2, 0.05));
      ctx.fillStyle = fill;
      ctx.fill();
    });

    const spin = 0.4 + this.motion.spin;
    for (const p of this.particles) {
      p.angle += p.speed * spin * dt * (1 + this.level * 2);
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 2 + p.phase);
      const orbit =
        base *
        (p.orbit + this.level * 0.25 + Math.sin(this.time + p.phase) * 0.04);
      const x = cx + orbit * Math.cos(p.angle);
      const y = cy + orbit * Math.sin(p.angle) * 0.92;
      const alpha = this.motion.particles * (0.15 + 0.55 * pulse);
      ctx.beginPath();
      ctx.arc(x, y, p.size * (window.devicePixelRatio || 1), 0, Math.PI * 2);
      ctx.fillStyle = rgba(pulse > 0.5 ? c1 : c2, alpha);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }
}
