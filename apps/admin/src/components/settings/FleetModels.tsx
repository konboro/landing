import { useMemo, useState } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { Card, CardHeader, Select } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/feedback';
import { LineTrend, chartPalette } from '@/components/charts/Charts';
import { useBrand } from '@/context/BrandContext';
import { titleCase } from '@/lib/format';

/* --------------------------------------------------------------------------
   Vehicle models + battery curves — deliberately READ-ONLY.

   `battery_curves` is not on the `admin-write` allowlist and has no edge
   function of its own, so there is no audited write path to it from the panel.
   This tab used to render editable number inputs over every calibration point;
   typing in them changed nothing but local React state, and the values were
   gone on the next render. Showing the calibration and saying plainly that it
   is not editable here beats an editor that quietly discards the edit.

   Row shapes are the tables' own (migration 00040): `battery_curves` is
   (id, model_id, points) — there is no `name` column.
   -------------------------------------------------------------------------- */

interface ModelRow {
  id: string;
  name: string;
  kind: string;
  battery_curve_id: string | null;
  max_speed_kmh: number;
  deposit_cents: number;
  requires_licence: boolean;
}

interface CurveRow {
  id: string;
  model_id: string;
  points: Array<[number, number]>;
}

export function FleetModels() {
  const { data: db, isLoading } = usePanelData();
  const { colors } = useBrand();

  const models = (db?.models ?? []) as unknown as ModelRow[];
  const curves = (db?.batteryCurves ?? []) as unknown as CurveRow[];

  const [curveId, setCurveId] = useState<string>('');
  const curve = curves.find((c) => c.id === curveId) ?? curves[0] ?? null;
  const curveLabel = (c: CurveRow) => models.find((m) => m.id === c.model_id)?.name ?? `curve ${c.id.slice(0, 8)}`;

  const points = useMemo(
    () => [...(curve?.points ?? [])].filter((p) => Array.isArray(p) && p.length === 2).sort((a, b) => a[0] - b[0]),
    [curve],
  );

  // The same linear interpolation the apps do, drawn so a miscalibrated curve
  // is visible rather than inferred from a column of numbers.
  const chartData = useMemo(() => {
    if (points.length < 2) return [];
    const min = points[0]![0];
    const max = points[points.length - 1]![0];
    const out: Array<{ v: number; soc: number }> = [];
    for (let v = min; v <= max; v += (max - min) / 40) {
      let soc = 0;
      for (let i = 1; i < points.length; i++) {
        if (v <= points[i]![0]) {
          const [v0, s0] = points[i - 1]!;
          const [v1, s1] = points[i]!;
          soc = v1 === v0 ? s1 : s0 + ((v - v0) / (v1 - v0)) * (s1 - s0);
          break;
        }
      }
      out.push({ v: +(v / 1000).toFixed(2), soc: +soc.toFixed(1) });
    }
    return out;
  }, [points]);

  if (isLoading) return <Card pad>Loading models…</Card>;

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <Card>
        <CardHeader title="Vehicle models" sub="Read-only — models and curves are provisioned by migration, not from the panel" />
        {models.length === 0 ? (
          <EmptyState emoji="🛴" title="No vehicle models" hint="Nothing in vehicle_models yet." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Name</th><th>Kind</th><th>Max speed</th><th>Deposit</th><th>Licence</th><th>Battery curve</th></tr>
              </thead>
              <tbody>
                {models.map((m) => {
                  const c = curves.find((x) => x.id === m.battery_curve_id);
                  return (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td>{titleCase(m.kind ?? '')}</td>
                      <td>{m.max_speed_kmh} km/h</td>
                      <td>{m.deposit_cents ? `€${(m.deposit_cents / 100).toFixed(2)}` : '—'}</td>
                      <td>{m.requires_licence ? 'Required' : 'No'}</td>
                      <td className="muted">{c ? `${c.points?.length ?? 0} calibration points` : 'none linked'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Battery curve"
          sub="voltage (mV) ↔ SoC (%) · linear interpolation between points"
          actions={curves.length > 1 ? (
            <Select style={{ width: 'auto' }} value={curve?.id ?? ''} onChange={(e) => setCurveId(e.target.value)}>
              {curves.map((c) => <option key={c.id} value={c.id}>{curveLabel(c)}</option>)}
            </Select>
          ) : undefined}
        />
        {!curve || points.length === 0 ? (
          <EmptyState emoji="🔋" title="No calibration points" hint="This deployment has no battery_curves rows to show." />
        ) : (
          <>
            <div className="card-pad grid" style={{ gridTemplateColumns: '1fr 1.4fr' }}>
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Voltage (mV)</th><th>SoC (%)</th></tr></thead>
                  <tbody>
                    {points.map((p, i) => (
                      <tr key={i}><td className="mono">{p[0]}</td><td className="mono">{p[1]}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                {chartData.length ? (
                  <LineTrend data={chartData} xKey="v" height={260} series={[{ key: 'soc', name: 'SoC %', color: chartPalette[1]! }]} />
                ) : (
                  <div className="muted">At least two points are needed to draw the curve.</div>
                )}
              </div>
            </div>
            <div className="card-pad" style={{ paddingTop: 0 }}>
              <div className="banner" style={{ borderColor: `${colors.warning}55`, background: `${colors.warning}12` }}>
                <div className="banner-bar" style={{ background: colors.warning }} />
                <div className="muted">
                  Curves cannot be edited here. <code>battery_curves</code> is not on the <code>admin-write</code> allowlist,
                  so the panel has no audited path to change a calibration — it takes a migration today.
                </div>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
