'use client';

/**
 * Inline-SVG line chart with gridlines, X/Y labels and optional dots on
 * each datapoint. Intentionally simple — 2D scale, single series. Good
 * enough for signups, retention, any small dashboard line.
 *
 * Accepts `ySuffix` to format Y axis labels (e.g. "%" for retention).
 */

import { useId, useMemo } from 'react';

export interface LineChartPoint {
  x: string;   // label on the X axis (already formatted)
  y: number;
}

export function LineChart({
  points,
  width = 420,
  height = 160,
  color = '#ffc542',
  areaColor = 'rgba(255,197,66,0.12)',
  ySuffix = '',
  yIntFormat = true,
  emptyLabel = 'Aucune donnée',
}: {
  points: LineChartPoint[];
  width?: number;
  height?: number;
  color?: string;
  areaColor?: string;
  ySuffix?: string;
  yIntFormat?: boolean;
  emptyLabel?: string;
}) {
  const uid = useId();

  const layout = useMemo(() => {
    const padL = 32;
    const padR = 12;
    const padT = 10;
    const padB = 22;
    return { padL, padR, padT, padB, innerW: width - padL - padR, innerH: height - padT - padB };
  }, [width, height]);

  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg text-[11px]"
        style={{ width, height, color: '#6b6488', background: 'rgba(255,255,255,0.02)' }}
      >
        {emptyLabel}
      </div>
    );
  }

  const maxY = Math.max(...points.map((p) => p.y), 1);
  const stepX = points.length > 1 ? layout.innerW / (points.length - 1) : layout.innerW;

  const coords = points.map((p, i) => {
    const x = layout.padL + i * stepX;
    const y = layout.padT + layout.innerH - (p.y / maxY) * layout.innerH;
    return { x, y, px: p.x, py: p.y };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${(layout.padT + layout.innerH).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(layout.padT + layout.innerH).toFixed(1)} Z`;

  // 3 Y gridlines at 0%/50%/100% of max
  const yTicks = [0, maxY / 2, maxY];
  // Thin X axis label set — show every k-th point so we don't overlap
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));

  const fmt = (v: number) =>
    yIntFormat
      ? Math.round(v).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
      : v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      {/* Grid */}
      {yTicks.map((t) => {
        const y = layout.padT + layout.innerH - (t / maxY) * layout.innerH;
        return (
          <g key={`grid-${uid}-${t}`}>
            <line
              x1={layout.padL}
              x2={width - layout.padR}
              y1={y}
              y2={y}
              stroke="rgba(255,255,255,0.04)"
              strokeDasharray="2 3"
            />
            <text
              x={layout.padL - 6}
              y={y + 3}
              textAnchor="end"
              fontSize="9"
              fill="#4a4468"
            >
              {fmt(t)}{ySuffix}
            </text>
          </g>
        );
      })}

      {/* Area + line */}
      <path d={areaPath} fill={areaColor} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />

      {/* Dots */}
      {coords.map((c, i) => (
        <circle key={`dot-${uid}-${i}`} cx={c.x} cy={c.y} r={2.5} fill={color} />
      ))}

      {/* X labels */}
      {coords.map((c, i) =>
        i % labelEvery === 0 || i === coords.length - 1 ? (
          <text
            key={`xlab-${uid}-${i}`}
            x={c.x}
            y={height - 6}
            textAnchor="middle"
            fontSize="9"
            fill="#6b6488"
          >
            {c.px}
          </text>
        ) : null,
      )}
    </svg>
  );
}
