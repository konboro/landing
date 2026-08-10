import { useQuery } from '@tanstack/react-query';
import { useDS } from '@/context/DataContext';
import { Card, CardHeader } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { relativeTime, formatDateTime } from '@/lib/format';
import type { VehicleIoFrame } from '@/types/domain';

/** How often we re-read. The FMB930 in this fleet reports on a ~5 min timer, so
 *  polling faster only burns requests — but a command changes a line within
 *  seconds, and an operator watching this panel after pressing Unlock wants to
 *  see it land. 4 s is the compromise: cheap enough to leave open, fast enough
 *  that the panel is not the reason you doubt the relay. */
const POLL_MS = 4000;
/** Frames older than this are stale enough that "current state" is a guess. */
const STALE_AFTER_MS = 15 * 60 * 1000;

/** One digital line, and — crucially — whether we actually measured it. */
function Line({
  label,
  role,
  value,
  reported,
  note,
}: {
  label: string;
  role: string;
  value: boolean | null;
  reported: boolean;
  note?: string;
}) {
  // Three states, not two. "Not reported" is not "off": the second is a
  // measurement, the first is the absence of one, and showing an unmeasured
  // relay as OFF is how someone ends up trusting a lock that was never read.
  const state = !reported ? 'unknown' : value ? 'high' : 'low';
  const tone = { high: 'success', low: 'neutral', unknown: 'warning' } as const;
  const text = { high: 'HIGH', low: 'LOW', unknown: 'not reported' } as const;

  return (
    <div className="between" style={{ padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
      <div>
        <div style={{ fontWeight: 700 }}>
          {label} <span className="muted" style={{ fontWeight: 400 }}>· {role}</span>
        </div>
        {note ? <div className="muted" style={{ fontSize: 12, maxWidth: 460 }}>{note}</div> : null}
      </div>
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <span
          aria-hidden
          style={{
            width: 12, height: 12, borderRadius: 6,
            background: state === 'high' ? 'var(--color-success)'
              : state === 'low' ? 'var(--color-border)'
                : 'var(--color-warning)',
          }}
        />
        <Badge tone={tone[state]}>{text[state]}</Badge>
      </div>
    </div>
  );
}

/**
 * Live state of the vehicle's digital lines.
 *
 * Reads `v_vehicle_io` (migration 00460), which reports each line as NULL
 * unless its AVL element was actually in the frame. DOUT1 (179) is absent from
 * this firmware profile's default IO set, so it shows as "not reported" until
 * someone enables the element in Teltonika Configurator — see the note the
 * component renders rather than a silent dash.
 */
export function IoMonitor({ vehicleId }: { vehicleId: string }) {
  const ds = useDS();
  const { data, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ['vehicle-io', vehicleId],
    queryFn: () => ds.getVehicleIo(vehicleId, 1),
    refetchInterval: POLL_MS,
    // Keep polling while the operator has the tab in the background — they
    // often press Unlock on the phone and come back to check the line.
    refetchIntervalInBackground: true,
  });

  const frame: VehicleIoFrame | undefined = data?.[0];
  const ageMs = frame ? Date.now() - new Date(frame.at).getTime() : null;
  const stale = ageMs !== null && ageMs > STALE_AFTER_MS;

  return (
    <Card>
      <CardHeader
        title="Digital lines"
        sub="DIN1 / DOUT1 / DOUT2 straight from the last AVL frame"
        actions={
          frame ? (
            <Badge tone={stale ? 'warning' : 'success'}>
              {stale ? `stale · ${relativeTime(frame.at)}` : `live · ${relativeTime(frame.at)}`}
            </Badge>
          ) : null
        }
      />
      <div className="card-pad">
        {isLoading ? <p className="muted">Reading…</p> : null}
        {error ? <p className="muted">Could not read telemetry: {(error as Error).message}</p> : null}
        {!isLoading && !error && !frame ? (
          <p className="muted">This vehicle has never reported a frame.</p>
        ) : null}

        {frame ? (
          <>
            <Line
              label="DIN1"
              role="ignition"
              value={frame.din1}
              reported={frame.din1_reported}
            />
            <Line
              label="DOUT1"
              role="lock relay"
              value={frame.dout1}
              reported={frame.dout1_reported}
              note={
                frame.dout1_reported
                  ? undefined
                  : 'AVL element 179 is not in this firmware profile’s IO set, so the relay state is never measured. Enable it in Teltonika Configurator → I/O; that also restores the second unlock-ACK source (docs/03).'
              }
            />
            <Line
              label="DOUT2"
              role="siren"
              value={frame.dout2}
              reported={frame.dout2_reported}
            />

            <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              Frame {formatDateTime(frame.at)}
              {frame.device_ts && frame.device_ts !== frame.at
                ? ` · device clock ${formatDateTime(frame.device_ts)}`
                : null}
              {' · '}refreshed {relativeTime(new Date(dataUpdatedAt).toISOString())}
            </div>
            {stale ? (
              <p className="muted" style={{ fontSize: 12 }}>
                Nothing new for {relativeTime(frame.at)} — these are the last values seen, not the
                current ones. The device reports on a timer and goes quiet in sleep mode.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </Card>
  );
}
