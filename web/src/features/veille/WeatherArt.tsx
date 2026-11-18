// Dessins de la météo : SVG intégrés (aucune image externe, CSP), décoratifs
// (aria-hidden, le libellé texte accompagne toujours le dessin). Couleurs par classes et
// variables CSS de veille.css (thèmes clair et sombre) ; animations discrètes coupées
// par prefers-reduced-motion.
import type { ReactNode } from "react";

import type { WeatherArtId } from "./veille";

function Sun({
  x = 32,
  y = 32,
  r = 12,
}: {
  x?: number;
  y?: number;
  r?: number;
}) {
  const rays = Array.from({ length: 8 }, (_, index) => {
    const angle = (index * Math.PI) / 4;
    const inner = r + 4;
    const outer = r + 9;
    return (
      <line
        key={index}
        x1={x + Math.cos(angle) * inner}
        y1={y + Math.sin(angle) * inner}
        x2={x + Math.cos(angle) * outer}
        y2={y + Math.sin(angle) * outer}
      />
    );
  });
  return (
    <g className="wa-sun-group">
      <g className="wa-rays">{rays}</g>
      <circle className="wa-sun" cx={x} cy={y} r={r} />
    </g>
  );
}

function Moon({
  x = 32,
  y = 30,
  r = 14,
}: {
  x?: number;
  y?: number;
  r?: number;
}) {
  // Croissant : disque moins un disque décalé
  return (
    <g className="wa-moon-group">
      <path
        className="wa-moon"
        d={`M ${x + r * 0.35} ${y - r} A ${r} ${r} 0 1 0 ${x + r} ${y + r * 0.45} A ${r * 0.85} ${r * 0.85} 0 0 1 ${x + r * 0.35} ${y - r} Z`}
      />
      <circle className="wa-star" cx={x - r - 2} cy={y - r + 2} r={1.4} />
      <circle className="wa-star" cx={x + r + 4} cy={y - r - 2} r={1.1} />
    </g>
  );
}

function Cloud({
  dark = false,
  dx = 0,
  dy = 0,
}: {
  dark?: boolean;
  dx?: number;
  dy?: number;
}) {
  return (
    <g
      className={dark ? "wa-cloud wa-cloud--dark" : "wa-cloud"}
      transform={`translate(${dx} ${dy})`}
    >
      <circle cx={23} cy={35} r={10} />
      <circle cx={35} cy={28} r={13} />
      <circle cx={46} cy={36} r={8.5} />
      <rect x={13} y={34} width={42} height={12} rx={6} />
    </g>
  );
}

function Drops({ count, short = false }: { count: number; short?: boolean }) {
  const starts = [20, 29, 38, 47].slice(0, count);
  return (
    <g className={short ? "wa-drops wa-drops--drizzle" : "wa-drops"}>
      {starts.map((x, index) => (
        <line
          key={x}
          className={`wa-drop wa-drop--${index}`}
          x1={x}
          y1={50}
          x2={x - (short ? 1.5 : 3)}
          y2={short ? 54 : 58}
        />
      ))}
    </g>
  );
}

function Flakes() {
  return (
    <g className="wa-flakes">
      {[
        [21, 52],
        [32, 56],
        [43, 52],
      ].map(([x = 0, y = 0], index) => (
        <g key={index} className={`wa-flake wa-drop--${index}`}>
          <line x1={x - 3} y1={y} x2={x + 3} y2={y} />
          <line x1={x - 1.5} y1={y - 2.6} x2={x + 1.5} y2={y + 2.6} />
          <line x1={x - 1.5} y1={y + 2.6} x2={x + 1.5} y2={y - 2.6} />
        </g>
      ))}
    </g>
  );
}

const ARTS: Record<WeatherArtId, () => ReactNode> = {
  "clear-day": () => <Sun />,
  "clear-night": () => <Moon />,
  "partly-cloudy-day": () => (
    <>
      <Sun x={24} y={22} r={9} />
      <Cloud dx={4} dy={6} />
    </>
  ),
  "partly-cloudy-night": () => (
    <>
      <Moon x={24} y={20} r={9} />
      <Cloud dx={4} dy={6} />
    </>
  ),
  cloudy: () => (
    <>
      <Cloud dark dx={-6} dy={-8} />
      <Cloud dx={3} dy={2} />
    </>
  ),
  fog: () => (
    <>
      <Cloud dy={-6} />
      <g className="wa-fog">
        <line x1={12} y1={48} x2={52} y2={48} />
        <line x1={18} y1={54} x2={56} y2={54} />
        <line x1={10} y1={60} x2={44} y2={60} />
      </g>
    </>
  ),
  drizzle: () => (
    <>
      <Cloud dy={-6} />
      <Drops count={3} short />
    </>
  ),
  rain: () => (
    <>
      <Cloud dark dy={-6} />
      <Drops count={4} />
    </>
  ),
  snow: () => (
    <>
      <Cloud dy={-6} />
      <Flakes />
    </>
  ),
  storm: () => (
    <>
      <Cloud dark dy={-8} />
      <path
        className="wa-bolt"
        d="M34 38 L26 51 H32 L28 62 L40 46 H33.5 L37 38 Z"
      />
      <Drops count={2} />
    </>
  ),
  unknown: () => (
    <>
      <Cloud dy={-4} />
      <text className="wa-unknown" x={34} y={43} textAnchor="middle">
        ?
      </text>
    </>
  ),
};

export function WeatherArt({
  art,
  size,
}: {
  art: WeatherArtId;
  size: "large" | "small";
}) {
  return (
    <svg
      className={`weather-art weather-art--${size}`}
      data-art={art}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      {ARTS[art]()}
    </svg>
  );
}
