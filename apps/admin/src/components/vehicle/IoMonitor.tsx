import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDS } from '@/context/DataContext';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, Button } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { ConfirmModal } from '@/components/ui/Modal';
import { relativeTime, formatDateTime } from '@/lib/format';
import type { VehicleIoFrame } from '@/types/domain';

/**
 * Which command drives which line.
 *
 * The physical mapping (DOUT1 = lock relay, DOUT2 = siren) is CONFIRMED by the
 * owner in docs/03 and lives in the gateway's `DoutProfile`, not here — the
 * panel only names the intent. Buttons are labelled by EFFECT rather than
 * "HIGH/LOW": whether energised means unlocked is a property of the harness,
 * and an operator pressing a button in the field is thinking "unlock it", not
 * "raise line 1".
 */
const LINE_COMMANDS: Record<'dout1' | 'dout2', { on: Cmd; off: Cmd; extra?: Cmd }> = {
  dout1: {
    on: { kind: 'unlock', label: 'Unlock' },
    off: { kind: 'lock', label: 'Lock' },
  },
  dout2: {
    on: { kind: 'alarm_on', label: 'Siren ON', danger: true },
    off: { kind: 'alarm_off', label: 'Siren OFF' },
    // A short pulse — the "find my scooter" pattern, rate-limited server-side.
    extra: { kind: 'ring', label: 'Ring' },
  },
};

interface Cmd { kind: string; label: string; danger?: boolean }

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
  controls,
}: {
  label: string;
  role: string;
  value: boolean | null;
  reported: boolean;
  note?: string;
  controls?: React.ReactNode;
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
        {controls}
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

/** The two (or three) buttons that drive one line. */
function Controls({ line, disabled, onFire }: {
  line: 'dout1' | 'dout2';
  disabled: boolean;
  onFire: (c: Cmd) => void;
}) {
  const set = LINE_COMMANDS[line];
  return (
    <div className="row" style={{ gap: 6 }}>
      {set.extra ? (
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onFire(set.extra!)}>
          {set.extra.label}
        </Button>
      ) : null}
      <Button size="sm" disabled={disabled} onClick={() => onFire(set.on)}>{set.on.label}</Button>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onFire(set.off)}>{set.off.label}</Button>
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
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const mayCommand = can('vehicles.command');
  const [confirming, setConfirming] = useState<Cmd | null>(null);
  const [lastSent, setLastSent] = useState<{ kind: string; at: number } | null>(null);

  const send = useMutation({
    mutationFn: (kind: string) => ds.sendCommand(vehicleId, kind),
    onSuccess: (_r, kind) => {
      // "Queued", not "done": vehicle-command returns a command_id, and the
      // gateway still has to reach the device over GPRS (or fall back to SMS).
      // Calling this "acked" here is how someone concludes a relay flipped when
      // it never did — the line below the row is the only real confirmation.
      toast.push(`${kind} queued — watch the line`, 'info');
      setLastSent({ kind, at: Date.now() });
      setConfirming(null);
      void qc.invalidateQueries({ queryKey: ['vehicle-io', vehicleId] });
    },
    onError: (e) => {
      toast.push(e instanceof Error ? e.message : 'Command failed', 'error');
      setConfirming(null);
    },
  });

  const fire = (c: Cmd) => {
    if (!mayCommand) return;
    // The siren is loud and the lock relay moves a vehicle someone may be
    // standing next to; both get a confirm, the pulse does not.
    if (c.danger) setConfirming(c);
    else send.mutate(c.kind);
  };

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
    <>
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
              controls={<Controls line="dout1" disabled={!mayCommand || send.isPending} onFire={fire} />}
              note={
                frame.dout1_reported
                  ? undefined
                  : 'AVL element 179 is not in this firmware profile’s IO set, so the relay state is never measured — these buttons send the command, but nothing here can confirm the relay moved. The Codec 12 reply in the command log is the only evidence. Enable 179 in Teltonika Configurator → I/O to get the second ACK source (docs/03).'
              }
            />
            <Line
              label="DOUT2"
              role="siren"
              value={frame.dout2}
              reported={frame.dout2_reported}
              controls={<Controls line="dout2" disabled={!mayCommand || send.isPending} onFire={fire} />}
            />

            {lastSent ? (
              <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                Sent <b>{lastSent.kind}</b> {relativeTime(new Date(lastSent.at).toISOString())}.
                {' '}
                {new Date(frame.at).getTime() > lastSent.at
                  ? 'A frame has arrived since — the state above is after the command.'
                  : 'No frame since. The device reports on a timer, so the line above is still the pre-command reading.'}
              </p>
            ) : null}

            {!mayCommand ? (
              <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                Your role cannot send commands.
              </p>
            ) : null}

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

    <ConfirmModal
      open={confirming !== null}
      onClose={() => setConfirming(null)}
      onConfirm={() => confirming && send.mutate(confirming.kind)}
      title={confirming?.label ?? ''}
      message={
        confirming?.kind === 'alarm_on'
          ? 'Starts the siren on this vehicle. It is audible from a distance and keeps running until an OFF command lands.'
          : 'Drives the lock relay. The vehicle may be in the street with someone next to it.'
      }
      danger
      busy={send.isPending}
      confirmLabel="Send"
    />
    </>
  );
}