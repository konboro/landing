// Reader for the PythonAnywhere `invoices_log.txt`.
//
// 22,471 lines, 2024-12-01 → 2026-08-14, AA 100 → 23108. It is the only record
// of which Stripe charge carries which AADE MARK, so it is imported rather than
// archived: reconciliation has to be able to see across the cutover.
//
// Two formats, because a Charge ID field was added on 2025-01-09 (from AA 959):
//
//   Success! Transaction ID: txn_..., AA number: 100, MARK: 4000..., Date: 2024-12-01
//   Success! Transaction ID: txn_..., Charge ID: ch_..., AA number: 23108, MARK: 4000..., Date: 2026-08-14
//
// FAIL lines put the error message where the MARK goes. A handful carry the
// literal string "None" as the transaction id.

export interface LegacyRow {
  lineNumber: number;
  ok: boolean;
  transactionId: string | null;
  chargeId: string | null;
  aa: number;
  /** MARK on success; the (usually useless) error text on failure. */
  mark: string | null;
  error: string | null;
  date: string; // YYYY-MM-DD
}

const FIELD = /(Transaction ID|Charge ID|AA number|MARK|Date): (.*?)(?=, (?:Transaction ID|Charge ID|AA number|MARK|Date): |\s*$)/g;

function nullIfNone(v: string | undefined): string | null {
  if (v === undefined) return null;
  const t = v.trim();
  return t === '' || t === 'None' ? null : t;
}

export function parseLegacyLine(line: string, lineNumber = 0): LegacyRow | null {
  if (!line.trim()) return null;
  const ok = line.startsWith('Success');
  if (!ok && !line.startsWith('FAIL')) return null;

  const fields: Record<string, string> = {};
  for (const m of line.matchAll(FIELD)) {
    const [, name, value] = m;
    if (name !== undefined && value !== undefined) fields[name] = value.trim();
  }

  const aa = Number.parseInt(fields['AA number'] ?? '', 10);
  const date = fields['Date'] ?? '';
  if (!Number.isInteger(aa) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const markField = nullIfNone(fields['MARK']);
  return {
    lineNumber,
    ok,
    transactionId: nullIfNone(fields['Transaction ID']),
    chargeId: nullIfNone(fields['Charge ID']),
    aa,
    mark: ok ? markField : null,
    error: ok ? null : (markField ?? 'unknown'),
    date,
  };
}

export function parseLegacyLog(contents: string): { rows: LegacyRow[]; unparsed: string[] } {
  const rows: LegacyRow[] = [];
  const unparsed: string[] = [];
  const lines = contents.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || !line.trim()) continue;
    const row = parseLegacyLine(line, i + 1);
    if (row) rows.push(row);
    else unparsed.push(line);
  }
  return { rows, unparsed };
}

/**
 * The correlation key for a legacy row.
 *
 * Prefer the Charge id; fall back to the transaction id for pre-2025-01-09 rows.
 * Rows with neither cannot be correlated to a payment at all and get a synthetic
 * per-row key so they are never accidentally grouped together — an earlier pass
 * that grouped them under a shared "None" key reported 86 duplicates instead of
 * the real 32.
 */
export function legacyKey(r: LegacyRow): string {
  return r.chargeId ?? r.transactionId ?? `__unidentified_aa${r.aa}`;
}
