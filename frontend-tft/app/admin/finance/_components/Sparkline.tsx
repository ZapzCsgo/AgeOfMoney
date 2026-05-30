'use client';

/**
 * Tiny inline-SVG sparkline. No chart lib required — we render 7 to 30
 * points, that's it. Auto-scales to [0, max] and paints a single polyline
 * with an optional area fill below for the "trend" look.
 *
 * Default colour is the arcane purple-bright (tft.money brand). Money-
 * specific callers pass `tft-gold-bright` explicitly.
 */

export function Sparkline({
  points,
  width = 96,
  height = 28,
  color = '#a78bfa',
  areaColor = 'rgba(167,139,250,0.12)',
}: {
  points: number[];
  width?: number;
  height?: number;
  color?: string;
  areaColor?: string;
}) {
  if (!points.length) {
    return <div style={{ width, height }} />;
  }

  const n   = points.length;
  const max = Math.max(...points, 1); // prevent div-by-zero; flat-zero → a flat line at the bottom
  const min = Math.min(...points, 0);
  const spread = max - min || 1;

  const stepX = width / Math.max(n - 1, 1);
  const pad   = 2; // keep the line off the very top/bottom edges

  const coords = points.map((v, i) => {
    const x = i * stepX;
    const y = height - pad - ((v - min) / spread) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const line = coords.join(' ');
  const area = `0,${height} ${line} ${width},${height}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polygon points={area} fill={areaColor} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
