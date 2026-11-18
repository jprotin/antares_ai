// Graphiques des statistiques, en SVG sans bibliothèque (CSP inchangée) : anneau de
// répartition, barres horizontales classées, colonnes empilées par jour, courbe d'un
// pourcentage. Couleurs par classe CSS (data-series), jamais en style en ligne. Chaque
// marque se survole ou se sélectionne au clavier : sa valeur s'affiche dans la ligne de
// lecture sous le graphique (aria-live). Les chiffres restent dans « Voir les chiffres ».
import { useState } from "react";

import type { VeilleCategory } from "@/types/api";

import { donutPaths, niceMax, percent, seriesSlot, shortDay } from "./stats";

type Slice = {
  slug: string;
  label: string;
  count: number;
  share: number | null;
};

function Readout({ text, idle }: { text: string; idle: string }) {
  return (
    <p className="veille-chart__readout" aria-live="polite">
      {text || idle}
    </p>
  );
}

// --- Anneau ----------------------------------------------------------------------------

export function Donut({
  title,
  slices,
  categories,
  unit,
}: {
  title: string;
  slices: readonly Slice[];
  categories: readonly VeilleCategory[];
  unit: (n: number) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const total = slices.reduce((sum, s) => sum + s.count, 0);
  const paths = donutPaths(
    slices.map((s) => s.count),
    50,
    32,
  );
  const current = active === null ? null : slices[active];
  return (
    <figure className="veille-chart veille-donut">
      <div className="veille-donut__plot">
        <svg
          viewBox="-52 -52 104 104"
          role="img"
          aria-label={`${title} : ${slices.map((s) => `${s.label} ${percent(s.share)}`).join(", ")}`}
        >
          {paths.map(({ index, path }) => {
            const slice = slices[index]!;
            return (
              <path
                key={slice.slug || index}
                d={path}
                fillRule="evenodd"
                className="veille-chart__mark"
                data-series={seriesSlot(slice.slug, categories)}
                data-active={active === index ? "true" : undefined}
                tabIndex={0}
                aria-label={`${slice.label} : ${percent(slice.share)}`}
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              />
            );
          })}
          <text
            className="veille-donut__total"
            x="0"
            y="-2"
            textAnchor="middle"
          >
            {current ? percent(current.share) : total}
          </text>
          <text className="veille-donut__sub" x="0" y="12" textAnchor="middle">
            {current ? current.label : "au total"}
          </text>
        </svg>
      </div>
      <ul className="veille-legend">
        {slices.map((slice, index) => (
          <li
            key={slice.slug || index}
            data-active={active === index ? "true" : undefined}
          >
            <span
              className="veille-legend__swatch"
              data-series={seriesSlot(slice.slug, categories)}
              aria-hidden="true"
            />
            <span className="veille-legend__label">{slice.label}</span>
            <span className="veille-legend__value">{percent(slice.share)}</span>
          </li>
        ))}
      </ul>
      <Readout
        idle="Survoler ou sélectionner un secteur pour le détail."
        text={
          current
            ? `${current.label} : ${unit(current.count)}, ${percent(current.share)}`
            : ""
        }
      />
    </figure>
  );
}

// --- Barres classées -------------------------------------------------------------------

export type BarRow = { label: string; value: number; note: string };

export function BarList({
  rows,
  valueLabel,
}: {
  rows: readonly BarRow[];
  valueLabel: (row: BarRow) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className="veille-bars">
      {rows.map((row, index) => (
        <li key={row.label} className="veille-bars__row">
          <span className="veille-bars__rank" aria-hidden="true">
            {index + 1}
          </span>
          <span className="veille-bars__label">{row.label}</span>
          <span className="veille-bars__value">{valueLabel(row)}</span>
          <svg
            className="veille-bars__track"
            viewBox="0 0 100 6"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <rect
              className="veille-bars__bar"
              x="0"
              y="0"
              rx="3"
              height="6"
              width={Math.max(2, (100 * row.value) / max)}
            />
          </svg>
          {row.note && <span className="veille-bars__note">{row.note}</span>}
        </li>
      ))}
    </ol>
  );
}

// --- Colonnes empilées par jour --------------------------------------------------------

const W = 320;
const H = 140;
const PAD = { top: 8, right: 4, bottom: 18, left: 24 };

export function DayColumns({
  days,
  categories,
}: {
  days: readonly { day: string; featured: Record<string, number> }[];
  categories: readonly VeilleCategory[];
}) {
  const [active, setActive] = useState<number | null>(null);
  const totals = days.map((d) =>
    Object.values(d.featured).reduce((s, v) => s + v, 0),
  );
  const max = niceMax(Math.max(0, ...totals));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const step = plotW / Math.max(1, days.length);
  const barW = Math.max(2, Math.min(18, step - 2));
  const slugs = [
    ...categories.map((c) => c.slug),
    ...[...new Set(days.flatMap((d) => Object.keys(d.featured)))].filter(
      (s) => !categories.some((c) => c.slug === s),
    ),
  ];
  const label = (slug: string) =>
    categories.find((c) => c.slug === slug)?.label ?? (slug || "Autre");
  const current = active === null ? null : days[active];
  const every = Math.ceil(days.length / 6);
  return (
    <figure className="veille-chart">
      <svg
        className="veille-chart__plot"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Articles mis à la une par jour et par catégorie"
      >
        {[0, max / 2, max].map((tick) => {
          const y = PAD.top + plotH - (plotH * tick) / max;
          return (
            <g key={tick}>
              <line
                className="veille-chart__grid"
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y}
                y2={y}
              />
              <text
                className="veille-chart__tick"
                x={PAD.left - 4}
                y={y + 3}
                textAnchor="end"
              >
                {tick}
              </text>
            </g>
          );
        })}
        {days.map((d, index) => {
          const x = PAD.left + step * index + (step - barW) / 2;
          let y = PAD.top + plotH;
          return (
            <g
              key={d.day}
              className="veille-chart__column"
              tabIndex={0}
              aria-label={`${shortDay(d.day)} : ${totals[index]} articles`}
              data-active={active === index ? "true" : undefined}
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
            >
              <rect
                className="veille-chart__hit"
                x={PAD.left + step * index}
                y={PAD.top}
                width={step}
                height={plotH}
              />
              {slugs.map((slug) => {
                const value = d.featured[slug] ?? 0;
                if (!value) return null;
                const h = (plotH * value) / max;
                y -= h;
                return (
                  <rect
                    key={slug}
                    className="veille-chart__mark"
                    data-series={seriesSlot(slug, categories)}
                    x={x}
                    y={y}
                    width={barW}
                    // Interstice de 2 unités entre segments empilés
                    height={Math.max(0.5, h - 2)}
                    rx={1.5}
                  />
                );
              })}
              {index % every === 0 && (
                <text
                  className="veille-chart__tick"
                  x={x + barW / 2}
                  y={H - 4}
                  textAnchor="middle"
                >
                  {shortDay(d.day)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <ul className="veille-legend veille-legend--row">
        {slugs
          .filter((slug) => days.some((d) => d.featured[slug]))
          .map((slug) => (
            <li key={slug}>
              <span
                className="veille-legend__swatch"
                data-series={seriesSlot(slug, categories)}
                aria-hidden="true"
              />
              <span className="veille-legend__label">{label(slug)}</span>
            </li>
          ))}
      </ul>
      <Readout
        idle="Survoler ou sélectionner un jour pour le détail."
        text={
          current
            ? `${shortDay(current.day)} : ${slugs
                .filter((s) => current.featured[s])
                .map((s) => `${label(s)} ${current.featured[s]}`)
                .join(", ")}`
            : ""
        }
      />
    </figure>
  );
}

// --- Courbe d'un pourcentage par jour --------------------------------------------------

export function PercentLine({
  points,
  label,
  detail,
}: {
  points: readonly { day: string; value: number | null }[];
  label: string;
  detail: (index: number) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const step = points.length > 1 ? plotW / (points.length - 1) : 0;
  const xy = points.map((p, index) => ({
    x: PAD.left + (points.length > 1 ? step * index : plotW / 2),
    y: p.value === null ? null : PAD.top + plotH - (plotH * p.value) / 100,
  }));
  // Segments continus entre jours renseignés (un jour sans vote coupe la courbe)
  const segments: string[] = [];
  let current = "";
  xy.forEach((p) => {
    if (p.y === null) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    current += `${current ? "L" : "M"} ${p.x} ${p.y} `;
  });
  if (current) segments.push(current);
  const every = Math.ceil(points.length / 6);
  return (
    <figure className="veille-chart">
      <svg
        className="veille-chart__plot"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
      >
        {[0, 50, 100].map((tick) => {
          const y = PAD.top + plotH - (plotH * tick) / 100;
          return (
            <g key={tick}>
              <line
                className="veille-chart__grid"
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y}
                y2={y}
              />
              <text
                className="veille-chart__tick"
                x={PAD.left - 4}
                y={y + 3}
                textAnchor="end"
              >
                {tick} %
              </text>
            </g>
          );
        })}
        {segments.map((d) => (
          <path key={d} d={d} className="veille-chart__line" />
        ))}
        {points.map((p, index) => {
          const at = xy[index]!;
          return (
            <g
              key={p.day}
              tabIndex={0}
              className="veille-chart__column"
              aria-label={`${shortDay(p.day)} : ${percent(p.value)}`}
              data-active={active === index ? "true" : undefined}
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
            >
              <rect
                className="veille-chart__hit"
                x={at.x - Math.max(step, 12) / 2}
                y={PAD.top}
                width={Math.max(step, 12)}
                height={plotH}
              />
              {at.y !== null && (
                <circle
                  className="veille-chart__dot"
                  cx={at.x}
                  cy={at.y}
                  r={active === index ? 4.5 : 3}
                />
              )}
              {index % every === 0 && (
                <text
                  className="veille-chart__tick"
                  x={at.x}
                  y={H - 4}
                  textAnchor="middle"
                >
                  {shortDay(p.day)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <Readout
        idle="Survoler ou sélectionner un jour pour le détail."
        text={active === null ? "" : detail(active)}
      />
    </figure>
  );
}
