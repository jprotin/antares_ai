// Avatar « photo » : une image locale animée en calques (canvas 2D).
// La mâchoire, découpée selon /avatars/photo.json, descend au rythme de la voix ; des
// halos se superposent aux yeux ; la tête respire légèrement. Même interface que l'orbe.
// L'image et son calibrage restent sur le poste (deploy/s2s/avatars, non versionné).

const CONFIG_URL = "avatars/photo.json";
const MOTION = {
  idle: { eyes: 0.35, scan: 0 },
  connecting: { eyes: 0.6, scan: 1 },
  listening: { eyes: 0.7, scan: 0 },
  user: { eyes: 0.8, scan: 0 },
  thinking: { eyes: 0.85, scan: 1 },
  speaking: { eyes: 1, scan: 0 },
};
const lerp = (a, b, t) => a + (b - a) * t;

let configPromise = null;
export function loadPhotoConfig() {
  configPromise ??= fetch(CONFIG_URL, { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then(
      (config) =>
        config &&
        new Promise((resolve) => {
          const image = new Image();
          image.onload = () => resolve({ ...config, element: image });
          image.onerror = () => resolve(null);
          image.src = `avatars/${encodeURIComponent(config.image)}`;
        }),
    )
    .catch(() => null);
  return configPromise;
}

export class PhotoFace {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.state = "idle";
    this.target = { level: 0 };
    this.level = 0;
    this.jaw = 0;
    this.eyes = MOTION.idle.eyes;
    this.scan = 0;
    this.time = 0;
    this.hueShift = 0;
    this.light = false;
    this.stopped = false;
    this.config = null;
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    loadPhotoConfig().then((config) => (this.config = config));
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
    this.time += dt * (this.reducedMotion ? 0.25 : 1);
    this.eyes = lerp(this.eyes, motion.eyes, ease);
    this.scan = lerp(this.scan, motion.scan, ease);
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
    if (this.config) this.draw();
    requestAnimationFrame((next) => this.frame(next));
  }

  draw() {
    const { ctx, canvas, config } = this;
    const {
      element: image,
      view,
      eyes,
      eyeRadius,
      jaw,
      mouthTop,
      jawTravel,
    } = config;
    const w = canvas.width;
    const h = canvas.height;
    const [x1, y1, x2, y2] = view;
    // Zone utile en « contain », avec une respiration et un léger balancement
    const breathe = 1 + Math.sin(this.time * 1.2) * 0.008;
    const scale = Math.min(w / (x2 - x1), h / (y2 - y1)) * breathe;
    const sway = Math.sin(this.time * 0.4) * 0.006;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(sway);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);

    ctx.drawImage(image, 0, 0);

    // Mâchoire : bouche sombre dans l'espace libéré, puis mâchoire décalée
    const drop = this.jaw * jawTravel;
    if (drop > 0.2) {
      const outline = () => {
        ctx.beginPath();
        jaw.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
      };
      ctx.save();
      outline();
      ctx.clip();
      const mouth = ctx.createLinearGradient(
        0,
        mouthTop,
        0,
        mouthTop + drop + 4,
      );
      mouth.addColorStop(0, "rgb(4, 3, 3)");
      mouth.addColorStop(1, "rgb(18, 8, 6)");
      ctx.fillStyle = mouth;
      ctx.fillRect(x1, mouthTop - 2, x2 - x1, drop + 6);
      ctx.restore();

      ctx.save();
      ctx.translate(0, drop);
      outline();
      ctx.clip();
      ctx.drawImage(image, 0, 0);
      ctx.restore();
    }

    // Yeux : halos additifs, pulsation en réflexion
    const pulse =
      this.state === "thinking" ? 0.7 + 0.3 * Math.sin(this.time * 8) : 1;
    const intensity = this.eyes * pulse;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const [ex, ey] of eyes) {
      const radius = eyeRadius * (2.4 + intensity * 0.8);
      const glow = ctx.createRadialGradient(ex, ey, 0, ex, ey, radius);
      glow.addColorStop(0, `rgba(255, 150, 90, ${0.55 * intensity})`);
      glow.addColorStop(0.25, `rgba(255, 40, 20, ${0.45 * intensity})`);
      glow.addColorStop(1, "rgba(255, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(ex, ey, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Balayage lumineux (réflexion, connexion)
    if (this.scan > 0.02) {
      const y = y1 + ((this.time * 0.35) % 1) * (y2 - y1);
      const band = ctx.createLinearGradient(0, y - 10, 0, y + 10);
      band.addColorStop(0, "rgba(255, 40, 40, 0)");
      band.addColorStop(0.5, `rgba(255, 40, 40, ${0.22 * this.scan})`);
      band.addColorStop(1, "rgba(255, 40, 40, 0)");
      ctx.fillStyle = band;
      ctx.fillRect(x1, y - 10, x2 - x1, 20);
    }
    ctx.restore();

    // Bords fondus : la photo se fond dans le fond de page (sombre ou clair)
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    const fade = ctx.createRadialGradient(
      w / 2,
      h * 0.46,
      Math.min(w, h) * 0.3,
      w / 2,
      h * 0.5,
      Math.max(w, h) * 0.62,
    );
    fade.addColorStop(0, "rgba(0,0,0,1)");
    fade.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}
