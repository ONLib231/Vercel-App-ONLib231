export interface SalesOverviewChartProps {
  totalLabel: string;
  changePct: number;
  /** Arbitrary-scale points (e.g. 0–100) — normalized internally to the chart's viewBox. */
  points: number[];
  rangeLabel?: string;
}

const WIDTH = 600;
const HEIGHT = 200;
const PADDING = 8;

/** Smooths a polyline into a single SVG path via quadratic curves through each segment's midpoint. */
function buildSmoothPath(coords: Array<[number, number]>): string {
  if (coords.length === 0) return "";

  const first = coords[0];
  if (!first) return "";
  if (coords.length === 1) return `M ${first[0]},${first[1]}`;

  let d = `M ${first[0]},${first[1]}`;
  for (let i = 0; i < coords.length - 1; i++) {
    // Safe: loop bounds guarantee both indices exist (i < coords.length - 1,
    // so i+1 <= coords.length - 1) — noUncheckedIndexedAccess just can't
    // prove that from the loop condition alone.
    const [x1, y1] = coords[i] as [number, number];
    const [x2, y2] = coords[i + 1] as [number, number];
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    d += ` Q ${x1},${y1} ${midX},${midY}`;
  }
  const last = coords[coords.length - 1] as [number, number];
  d += ` L ${last[0]},${last[1]}`;
  return d;
}

/**
 * Lightweight inline-SVG area chart for the Vendor Dashboard's "Sales
 * Overview" card — no charting library is installed, so this hand-builds a
 * smoothed line + gradient fill from a plain numeric array, matching the
 * look of both attached mockups closely enough without the dependency.
 */
export function SalesOverviewChart({ totalLabel, changePct, points, rangeLabel = "Last 30 Days" }: SalesOverviewChartProps) {
  const usablePoints = points.length > 0 ? points : [0];
  const max = Math.max(...usablePoints, 1);
  const min = Math.min(...usablePoints, 0);
  const span = Math.max(max - min, 1);

  const coords: Array<[number, number]> = usablePoints.map((value, i) => {
    const x = usablePoints.length === 1 ? WIDTH / 2 : PADDING + (i / (usablePoints.length - 1)) * (WIDTH - PADDING * 2);
    const y = HEIGHT - PADDING - ((value - min) / span) * (HEIGHT - PADDING * 2);
    return [x, y];
  });

  const linePath = buildSmoothPath(coords);
  const firstCoord = coords[0] as [number, number];
  const lastCoord = coords[coords.length - 1] as [number, number];
  const areaPath = `${linePath} L ${lastCoord[0]},${HEIGHT} L ${firstCoord[0]},${HEIGHT} Z`;
  const isPositive = changePct >= 0;

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">
          Sales Overview <span className="font-normal text-slate-400">({rangeLabel})</span>
        </p>
        <span className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500">{rangeLabel}</span>
      </div>

      <div className="mb-2 flex items-baseline gap-2">
        <p className="text-2xl font-extrabold text-slate-900 sm:text-3xl">{totalLabel}</p>
        <span className={`text-sm font-semibold ${isPositive ? "text-emerald-600" : "text-onlib-600"}`}>
          {isPositive ? "▲" : "▼"} {Math.abs(changePct).toFixed(1)}%
        </span>
      </div>

      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-40 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3d4fe0" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#3d4fe0" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#salesFill)" stroke="none" />
        <path d={linePath} fill="none" stroke="#2f3fc7" strokeWidth={3} strokeLinecap="round" />
      </svg>
    </div>
  );
}
