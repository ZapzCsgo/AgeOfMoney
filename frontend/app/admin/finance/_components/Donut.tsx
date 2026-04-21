'use client';

/**
 * SVG donut for the Products breakdown. Each slice gets a deterministic
 * shade of the gold palette so there is never a clown-rainbow.
 *
 * Slices with 0 value are skipped (no visual space). When the total is 0
 * the donut renders a neutral placeholder ring so the layout never
 * collapses.
 */

interface Slice {
  label: string;
  value: number;
  color: string;
}

// Gold / bronze palette — variations on the AgeOfMoney accent so nothing
// looks like a stock Stripe chart.
export const PRODUCT_PALETTE = [
  '#ffc542', // bright gold (primary)
  '#d4a017', // darker gold
  '#f5c842', // warm yellow
  '#b8860b', // dark goldenrod
  '#8b6914', // olive bronze
  '#4a3804', // deep olive
];

export function paletteColor(index: number): string {
  return PRODUCT_PALETTE[index % PRODUCT_PALETTE.length];
}

function describeArc(cx: number, cy: number, r: number, startAngleDeg: number, endAngleDeg: number): string {
  // SVG arc helper — inputs are 0°=12 o'clock, clockwise.
  const polar = (angle: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const start = polar(endAngleDeg);
  const end   = polar(startAngleDeg);
  const large = endAngleDeg - startAngleDeg <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 0 ${end.x} ${end.y}`;
}

export function Donut({
  slices,
  size = 160,
  thickness = 24,
  centerLabel,
  centerValue,
}: {
  slices: Slice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const r  = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;

  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const nonZero = slices.filter((s) => s.value > 0);

  if (total === 0 || nonZero.length === 0) {
    // Placeholder ring when there's no data yet
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={thickness} />
        {(centerLabel || centerValue) && (
          <>
            {centerValue && (
              <text x={cx} y={cy - 6} textAnchor="middle" fontSize="16" fontWeight="bold" fill="#6b6488" style={{ fontFamily: 'Cinzel, serif' }}>
                {centerValue}
              </text>
            )}
            {centerLabel && (
              <text x={cx} y={cy + 12} textAnchor="middle" fontSize="9" fill="#4a4468" letterSpacing="2">
                {centerLabel}
              </text>
            )}
          </>
        )}
      </svg>
    );
  }

  // Draw slices as stroked arcs
  let cursor = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* faint background ring so the gaps between small arcs aren't blocky */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={thickness} />
      {nonZero.map((s) => {
        const pct = s.value / total;
        const startAngle = cursor * 360;
        const endAngle   = (cursor + pct) * 360;
        cursor += pct;
        // If a single slice = 100%, SVG arcs can't draw a 360° arc — render
        // the full circle instead.
        const d = pct >= 0.999
          ? null
          : describeArc(cx, cy, r, startAngle, endAngle);
        if (!d) {
          return (
            <circle
              key={s.label}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
            />
          );
        }
        return (
          <path
            key={s.label}
            d={d}
            fill="none"
            stroke={s.color}
            strokeWidth={thickness}
            strokeLinecap="butt"
          />
        );
      })}
      {centerValue && (
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          fontSize="18"
          fontWeight="bold"
          fill="#ffd97a"
          style={{ fontFamily: 'Cinzel, serif' }}
        >
          {centerValue}
        </text>
      )}
      {centerLabel && (
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          fontSize="9"
          fill="#6b6488"
          letterSpacing="2"
        >
          {centerLabel}
        </text>
      )}
    </svg>
  );
}
