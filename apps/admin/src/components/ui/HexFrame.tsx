import { palette } from '@penny/ui';

interface Seg { label: string; hex: string; note?: string }

// A representative Teltonika Codec 8E (extended) TCP frame, field-annotated.
const SAMPLE: Seg[] = [
  { label: 'Preamble', hex: '00000000', note: 'always zero' },
  { label: 'Data length', hex: '00000036', note: '54 bytes' },
  { label: 'Codec ID', hex: '8E', note: 'Codec 8 Extended' },
  { label: 'Records (n1)', hex: '01', note: '1 AVL record' },
  { label: 'Timestamp', hex: '0000018F2A3B4C00', note: 'ms since epoch (UTC)' },
  { label: 'Priority', hex: '01', note: 'high' },
  { label: 'Longitude', hex: '016A2B3C', note: '23.7275° ×1e7' },
  { label: 'Latitude', hex: '169C4D5E', note: '37.9838° ×1e7' },
  { label: 'Altitude', hex: '004E', note: '78 m' },
  { label: 'Angle', hex: '00B4', note: '180°' },
  { label: 'Satellites', hex: '0A', note: '10 sats' },
  { label: 'Speed', hex: '0012', note: '18 km/h' },
  { label: 'Event IO ID', hex: '00EF', note: 'ignition (ext)' },
  { label: 'Total IO', hex: '0009', note: '9 elements' },
  { label: '1-byte IO', hex: '0002 EF01 2401', note: 'ignition=1, movement=1' },
  { label: '2-byte IO', hex: '0002 42' + '2E14' + ' 43' + '0B54', note: 'ext V=11.796V, batt V=2.9V' },
  { label: '4-byte IO', hex: '0001 F00000001C', note: 'odometer' },
  { label: '8-byte IO', hex: '0000', note: 'none' },
  { label: 'Records (n2)', hex: '01', note: 'must match n1' },
  { label: 'CRC-16', hex: '0000C7A2', note: 'IBM/ARC over data field' },
];

const COLORS = [palette.blue500, palette.green500, palette.amber500, palette.blue300, '#8a5cf6', palette.red400, palette.blue700, palette.green400];

export function HexFrame() {
  return (
    <div>
      <div className="hex-viewer">
        {SAMPLE.map((s, i) => (
          <span key={i} className="hex-field" style={{ background: `${COLORS[i % COLORS.length]}33`, color: '#fff', marginRight: 6 }} title={`${s.label}${s.note ? ` — ${s.note}` : ''}`}>
            {s.hex.replace(/\s/g, '')}
          </span>
        ))}
      </div>
      <div className="scroll-x" style={{ marginTop: 12 }}>
        <table className="data" style={{ fontSize: 12 }}>
          <thead><tr><th>#</th><th>Field</th><th>Hex</th><th>Decoded</th></tr></thead>
          <tbody>
            {SAMPLE.map((s, i) => (
              <tr key={i}>
                <td><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: COLORS[i % COLORS.length] }} /></td>
                <td>{s.label}</td>
                <td className="mono">{s.hex}</td>
                <td className="muted">{s.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
