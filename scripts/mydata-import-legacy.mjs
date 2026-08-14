#!/usr/bin/env node
/**
 * Import the PythonAnywhere myDATA history into mydata_submissions.
 *
 * The legacy pipeline's `invoices_log.txt` is the only record of which Stripe
 * charge carries which AADE MARK. It has to come across, otherwise the platform
 * cannot tell an unfiled payment from one PythonAnywhere already filed, and the
 * cutover risks double-declaring income.
 *
 * The script does NOT write to the database. It emits idempotent SQL for a human
 * to read and apply — this touches tax filings, and 22k INSERTs generated from a
 * text file deserve a second pair of eyes.
 *
 * Usage:
 *   node --experimental-strip-types scripts/mydata-import-legacy.mjs \
 *        --log "../myData integration/invoices_log.txt" --out supabase/seed-mydata-legacy.sql
 *
 * Flags:
 *   --log <path>     invoices_log.txt                 (required)
 *   --out <path>     write SQL here          (default: stdout summary only)
 *   --series <name>  myDATA series for these rows     (default: ΑΠΥ)
 *   --batch <n>      rows per INSERT statement        (default: 500)
 *   --quiet          suppress the exception report
 *
 * Apply the result with:
 *   psql "$DB_URL" -f supabase/seed-mydata-legacy.sql
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { legacyKey, parseLegacyLog } from '../services/edge/invoicing/legacy.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const logPath = arg('log');
const outPath = arg('out');
const series = arg('series', 'ΑΠΥ');
const batchSize = Number(arg('batch', '500'));
const quiet = flag('quiet');

if (!logPath) {
  console.error('--log <path to invoices_log.txt> is required');
  process.exit(1);
}

const contents = readFileSync(resolve(process.cwd(), logPath), 'utf8');
const { rows, unparsed } = parseLegacyLog(contents);

if (rows.length === 0) {
  console.error('no rows parsed — is that the right file?');
  process.exit(1);
}

// ── analysis ──────────────────────────────────────────────────────────────
const byKey = new Map();
for (const r of rows) {
  const k = legacyKey(r);
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push(r);
}

const neverFiled = [];
const doubleFiled = [];
for (const [k, group] of byKey) {
  const ok = group.filter((r) => r.ok);
  if (ok.length === 0) neverFiled.push({ key: k, rows: group });
  else if (ok.length > 1) doubleFiled.push({ key: k, rows: ok.sort((a, b) => a.aa - b.aa) });
}

const aas = rows.map((r) => r.aa).sort((a, b) => a - b);
const lo = aas[0];
const hi = aas[aas.length - 1];
const present = new Set(aas);
const unissued = [];
for (let a = lo; a <= hi; a++) if (!present.has(a)) unissued.push(a);
const burned = rows.filter((r) => !r.ok).map((r) => r.aa);

const sent = rows.filter((r) => r.ok).length;

if (!quiet) {
  const ranges = [];
  for (const n of unissued) {
    const last = ranges[ranges.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else ranges.push([n, n]);
  }
  console.error(`
  legacy myDATA log — ${logPath}
  ────────────────────────────────────────────────────────────
  rows parsed          ${rows.length}${unparsed.length ? `  (${unparsed.length} unreadable)` : ''}
  with a MARK          ${sent}
  failed attempts      ${rows.length - sent}
  AA range             ${lo} .. ${hi}   (${hi - lo + 1} numbers)
  date range           ${rows[0].date} .. ${rows[rows.length - 1].date}

  needs an accountant
  ────────────────────────────────────────────────────────────
  never filed          ${neverFiled.length}  payments taken with no receipt at AADE
  double filed         ${doubleFiled.length}  payments with two MARKs
  holes in the series  ${unissued.length + burned.length}  (${burned.length} burned by failures, ${unissued.length} never issued)
${ranges.filter(([s, e]) => e - s > 0).map(([s, e]) => `    block ${s}-${e} (${e - s + 1})`).join('\n')}

  next AA              ${hi + 1}   <- mydata_series.next_aa / floor_aa
`);
}

if (!outPath) {
  console.error('  (no --out given; wrote no SQL)\n');
  process.exit(0);
}

// ── SQL ───────────────────────────────────────────────────────────────────
const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

const values = rows.map((r) => {
  // A row with a MARK was really filed; anything else was not. The table's
  // mydata_sent_has_mark constraint enforces that pairing, so this mapping is
  // the only one that will load.
  const status = r.ok && r.mark ? 'sent' : 'failed';
  return `(${[
    `'legacy'`,
    q(r.chargeId),
    q(r.transactionId),
    q(series),
    r.aa,
    q(r.date),
    `'live'`,
    q(status),
    q(r.ok ? r.mark : null),
    q(r.ok ? null : r.error),
    r.ok ? `${q(r.date)}::timestamptz` : 'null',
  ].join(', ')})`;
});

const chunks = [];
for (let i = 0; i < values.length; i += batchSize) {
  chunks.push(values.slice(i, i + batchSize));
}

const sql = `-- Generated by scripts/mydata-import-legacy.mjs — do not edit by hand.
-- Source: ${logPath}
-- ${rows.length} rows, AA ${lo}..${hi}, ${rows[0].date}..${rows[rows.length - 1].date}
--
-- Imported history from the PythonAnywhere pipeline. These receipts were filed
-- by the legacy system; the platform never re-transmits them (mydata_claim
-- filters source='platform'). They exist so that reconciliation, the series-gap
-- view and the panel can see across the cutover.
--
-- No amounts: the legacy log recorded AA / MARK / date / Stripe ids only.
--
-- Idempotent: re-running changes nothing (unique on series+aa).

begin;

${chunks
  .map(
    (c) => `insert into mydata_submissions
  (source, stripe_charge_id, stripe_pi_id, series, aa, issue_date, mode, status, mark, last_error, sent_at)
values
${c.join(',\n')}
on conflict (series, aa) do nothing;`,
  )
  .join('\n\n')}

-- The series continues from the legacy high-water mark. floor_aa is the lowest
-- number the platform may issue; anything below it was used by the legacy
-- system, and the pre-send guard refuses to transmit it.
insert into mydata_series (series, next_aa, floor_aa, note)
values (${q(series)}, ${hi + 1}, ${hi + 1}, 'imported from invoices_log.txt; last legacy receipt AA ${hi}')
on conflict (series) do update
  set next_aa  = greatest(mydata_series.next_aa, excluded.next_aa),
      floor_aa = greatest(mydata_series.floor_aa, excluded.floor_aa),
      updated_at = now();

commit;

-- Post-import checks (should print ${rows.length}, ${sent}, and ${hi + 1}):
--   select count(*) from mydata_submissions where source = 'legacy';
--   select count(*) from mydata_submissions where source = 'legacy' and status = 'sent';
--   select next_aa from mydata_series where series = ${q(series)};
`;

const target = resolve(process.cwd(), outPath);
writeFileSync(target, sql, 'utf8');
console.error(`  wrote ${rows.length} rows -> ${target.replace(ROOT + '\\', '').replace(ROOT + '/', '')}\n`);
