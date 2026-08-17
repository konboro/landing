#!/usr/bin/env node
/**
 * Import the PythonAnywhere myDATA history into mydata_submissions.
 *
 * The legacy pipeline's `invoices_log.txt` is the only record of which Stripe
 * charge carries which AADE MARK. It has to come across, otherwise the platform
 * cannot tell an unfiled payment from one PythonAnywhere already filed, and the
 * cutover risks double-declaring income.
 *
 * Two modes:
 *
 *   --out <file>            write idempotent SQL for a human to read first
 *   --apply --project-ref   send it batch by batch via the Management API
 *
 * `--apply` deliberately does NOT wrap everything in one transaction. Each batch
 * is independently idempotent (`on conflict do nothing`), so an interrupted run
 * is resumable by re-running it, and a 3.8 MB single statement never has to
 * survive one HTTP request.
 *
 * Usage:
 *   node --experimental-strip-types scripts/mydata-import-legacy.mjs \
 *        --log "../myData integration/invoices_log.txt" --out supabase/seed-mydata-legacy.sql
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node --experimental-strip-types \
 *     scripts/mydata-import-legacy.mjs --log <path> --apply --project-ref <ref>
 *
 * Flags:
 *   --log <path>       invoices_log.txt                 (required)
 *   --out <path>       write SQL here          (default: stdout summary only)
 *   --apply            send to the database via the Management API
 *   --project-ref <r>  target project                   (required with --apply)
 *   --series <name>    myDATA series for these rows     (default: ΑΠΥ)
 *   --batch <n>        rows per INSERT statement        (default: 500)
 *   --quiet            suppress the exception report
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
const apply = flag('apply');
const projectRef = arg('project-ref');

if (!logPath) {
  console.error('--log <path to invoices_log.txt> is required');
  process.exit(1);
}
if (apply && !projectRef) {
  console.error('--apply needs --project-ref <ref>');
  process.exit(1);
}
if (apply && !process.env.SUPABASE_ACCESS_TOKEN) {
  console.error('--apply needs SUPABASE_ACCESS_TOKEN in the environment');
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

if (!outPath && !apply) {
  console.error('  (no --out or --apply given; changed nothing)\n');
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

// Each element is independently runnable and idempotent — that is what lets
// --apply send them one at a time and resume after an interruption.
const statements = [
  ...chunks.map(
    (c) => `insert into mydata_submissions
  (source, stripe_charge_id, stripe_pi_id, series, aa, issue_date, mode, status, mark, last_error, sent_at)
values
${c.join(',\n')}
on conflict (series, aa) do nothing;`,
  ),
  // The series continues from the legacy high-water mark. Applied last, so an
  // interrupted import never advances the counter past what actually loaded.
  `insert into mydata_series (series, next_aa, floor_aa, note)
values (${q(series)}, ${hi + 1}, ${hi + 1}, 'imported from invoices_log.txt; last legacy receipt AA ${hi}')
on conflict (series) do update
  set next_aa  = greatest(mydata_series.next_aa, excluded.next_aa),
      floor_aa = greatest(mydata_series.floor_aa, excluded.floor_aa),
      updated_at = now();`,
];

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

${statements.join('\n\n')}

commit;

-- Post-import checks (should print ${rows.length}, ${sent}, and ${hi + 1}):
--   select count(*) from mydata_submissions where source = 'legacy';
--   select count(*) from mydata_submissions where source = 'legacy' and status = 'sent';
--   select next_aa from mydata_series where series = ${q(series)};
`;

if (outPath) {
  const target = resolve(process.cwd(), outPath);
  writeFileSync(target, sql, 'utf8');
  console.error(`  wrote ${rows.length} rows -> ${target.replace(ROOT + '\\', '').replace(ROOT + '/', '')}\n`);
}

if (!apply) process.exit(0);

// ── apply ─────────────────────────────────────────────────────────────────
const API = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

async function run(statement) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: statement }),
  });
  if (!res.ok) {
    // The body carries the Postgres error; the status alone says nothing useful.
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  return res.json();
}

console.error(`  applying ${statements.length} batches to ${projectRef}…`);

for (let i = 0; i < statements.length; i++) {
  const label = i === statements.length - 1 ? 'series counter' : `batch ${i + 1}/${statements.length - 1}`;
  try {
    await run(statements[i]);
    process.stderr.write(`\r  ${label} ok${' '.repeat(20)}`);
  } catch (err) {
    process.stderr.write('\n');
    console.error(`  FAILED on ${label}: ${err.message}`);
    console.error('  Nothing is half-written: every batch is idempotent, so re-run to resume.');
    process.exit(1);
  }
}
process.stderr.write('\n');

// Read back rather than assume. An import that reports success without checking
// is how you find out months later that half of it is missing.
const [check] = await run(`select
  (select count(*) from mydata_submissions where source = 'legacy') as imported,
  (select count(*) from mydata_submissions where source = 'legacy' and status = 'sent') as with_mark,
  (select count(*) from v_mydata_series_gaps) as gaps,
  (select next_aa from mydata_series where series = ${q(series)}) as next_aa`);

const okRows = Number(check.imported) === rows.length;
const okMark = Number(check.with_mark) === sent;

console.error(`
  imported     ${check.imported}   ${okRows ? 'ok' : `EXPECTED ${rows.length}`}
  with a MARK  ${check.with_mark}   ${okMark ? 'ok' : `EXPECTED ${sent}`}
  series gaps  ${check.gaps}
  next AA      ${check.next_aa}
`);

process.exit(okRows && okMark ? 0 : 1);
