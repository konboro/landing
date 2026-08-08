import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { palette, colors } from '@penny/ui';

const AXIS = { fontSize: 11, fill: colors.textMuted };
const GRID = colors.border;

/* ---------- Sparkline (lightweight inline SVG) ---------- */
export function Sparkline({ data, color = colors.primary, width = 100, height = 30 }: { data: number[]; color?: string; width?: number; height?: number }) {
  if (!data.length) return <svg width={width} height={height} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / Math.max(1, data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * (height - 4) - 2).toFixed(1)}`).join(' ');
  const last = data[data.length - 1]!;
  const lastX = (data.length - 1) * step;
  const lastY = height - ((last - min) / range) * (height - 4) - 2;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={2.4} fill={color} />
    </svg>
  );
}

/* ---------- Semicircle gauge ---------- */
export function Gauge({ value, label, size = 150 }: { value: number; label?: string; size?: number }) {
  const v = Math.max(0, Math.min(100, value));
  const r = size / 2 - 12;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const startA = Math.PI;
  const endA = Math.PI - (v / 100) * Math.PI;
  const polar = (a: number) => [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  const [sx, sy] = polar(startA);
  const [ex, ey] = polar(endA);
  const [tx, ty] = polar(0);
  const large = 0;
  const col = v >= 95 ? colors.success : v >= 85 ? colors.warning : colors.danger;
  return (
    <div className="gauge-wrap" style={{ width: size }}>
      <svg width={size} height={size / 1.6}>
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 0 1 ${tx} ${ty}`} fill="none" stroke={colors.surfaceAlt} strokeWidth={12} strokeLinecap="round" />
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`} fill="none" stroke={col} strokeWidth={12} strokeLinecap="round" />
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize={22} fontWeight={700} fill={colors.text}>{v.toFixed(1)}%</text>
        {label ? <text x={cx} y={cy + 14} textAnchor="middle" fontSize={11} fill={colors.textMuted}>{label}</text> : null}
      </svg>
    </div>
  );
}

/* ---------- Donut ---------- */
export interface DonutSlice { label: string; value: number; color: string }
export function Donut({ data, size = 180, centerLabel, centerValue }: { data: DonutSlice[]; size?: number; centerLabel?: string; centerValue?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <PieChart width={size} height={size}>
        <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={size * 0.3} outerRadius={size * 0.46} paddingAngle={2} stroke="none">
          {data.map((d, i) => <Cell key={i} fill={d.color} />)}
        </Pie>
        <Tooltip />
      </PieChart>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{centerValue ?? total}</div>
          {centerLabel ? <div className="muted" style={{ fontSize: 11 }}>{centerLabel}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function DonutLegend({ data }: { data: DonutSlice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="stack" style={{ gap: 6 }}>
      {data.map((d) => (
        <div key={d.label} className="between" style={{ fontSize: 13 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color }} />
            {d.label}
          </span>
          <span className="muted">{d.value} · {total ? Math.round((d.value / total) * 100) : 0}%</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Trend line ---------- */
export interface Series { key: string; name: string; color: string }
export function TrendLine({ data, xKey, series, height = 260, stacked }: { data: Record<string, unknown>[]; xKey: string; series: Series[]; height?: number; stacked?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} fill={`url(#g-${s.key})`} strokeWidth={2} stackId={stacked ? '1' : undefined} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function LineTrend({ data, xKey, series, height = 240 }: { data: Record<string, unknown>[]; xKey: string; series: Series[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={20} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ---------- Bars ---------- */
export function Bars({ data, xKey, series, height = 260, stacked }: { data: Record<string, unknown>[]; xKey: string; series: Series[]; height?: number; stacked?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={12} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} stackId={stacked ? '1' : undefined} radius={[3, 3, 0, 0]} maxBarSize={38} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export const chartPalette = [palette.blue500, palette.green500, palette.amber500, palette.blue300, '#8a5cf6', palette.red400, palette.blue700];
