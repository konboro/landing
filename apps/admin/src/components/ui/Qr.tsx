// Placeholder QR-style glyph. Deterministic from the payload so labels look
// consistent. NOT a scannable QR code — swap for a real encoder (e.g. `qrcode`)
// when generating production labels.
export function Qr({ value, size = 140 }: { value: string; size?: number }) {
  const n = 21;
  const cells: boolean[] = [];
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
  let s = h >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < n * n; i++) cells.push(rnd() > 0.5);
  const cell = size / n;
  const finder = (x: number, y: number) => (
    <g key={`f${x}${y}`}>
      <rect x={x * cell} y={y * cell} width={cell * 7} height={cell * 7} fill="#000" />
      <rect x={(x + 1) * cell} y={(y + 1) * cell} width={cell * 5} height={cell * 5} fill="#fff" />
      <rect x={(x + 2) * cell} y={(y + 2) * cell} width={cell * 3} height={cell * 3} fill="#000" />
    </g>
  );
  const inFinder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  return (
    <svg width={size} height={size} style={{ background: '#fff' }}>
      {cells.map((on, i) => {
        const r = Math.floor(i / n); const c = i % n;
        if (inFinder(r, c) || !on) return null;
        return <rect key={i} x={c * cell} y={r * cell} width={cell} height={cell} fill="#000" />;
      })}
      {finder(0, 0)}{finder(n - 7, 0)}{finder(0, n - 7)}
    </svg>
  );
}
