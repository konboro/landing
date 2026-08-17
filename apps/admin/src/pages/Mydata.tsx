// myDATA (AADE) — the review desk.
//
// The legacy pipeline mailed a CSV every morning and an employee scanned it for
// problems, then fixed those by hand through the AADE portal. This page is that
// job, with the three things the CSV could never carry: why a receipt failed,
// the exact document that was sent, and somewhere to record what was done about
// it. See docs/18-mydata.md.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMydata, useMydataDetail, useMydataMutation, mydataErrorMessage } from '@/hooks/useMydata';
import { Button, Card, CardHeader, Field, Input, Select, Textarea, KV, Spinner } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { PageHeader } from '@/components/ui/PageHeader';
import { Drawer, ConfirmModal, Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { downloadCsv } from '@/lib/csv';
import { formatMoney, titleCase, formatDateTime, relativeTime, shortId } from '@/lib/format';
import { colors } from '@penny/ui';
import type { MydataAction } from '@/data/api';
import type {
  MydataDailyRow,
  MydataGap,
  MydataIssue,
  MydataIssueKind,
  MydataState,
  MydataStatus,
  MydataSubmission,
} from '@/types/domain';

const STATUS_TONE: Record<MydataStatus, 'success' | 'danger' | 'warning' | 'neutral'> = {
  sent: 'success', failed: 'danger', pending: 'warning', sending: 'warning',
  cancelled: 'neutral', skipped: 'neutral',
};

const ISSUE_LABEL: Record<MydataIssueKind, string> = {
  failed: 'Not filed',
  no_receipt: 'Payment with no receipt',
  duplicate: 'Filed twice',
  gap: 'Missing number',
  stalled: 'Stuck',
};

/** What the reviewer is actually being asked to do about each kind of problem. */
const ISSUE_ACTION: Record<MydataIssueKind, string> = {
  failed: 'Read the error. Retry if it was transient, or file it on the AADE portal and record the MARK here.',
  no_receipt: 'A charge went through with no receipt at all. Check the payment, then issue one.',
  duplicate: 'The same charge was declared twice. The surplus receipt needs a credit note at AADE.',
  gap: 'A receipt number with no document behind it. Inherited from the old system — confirm with the accountant, then note it as reviewed.',
  stalled: 'In flight far longer than the backoff allows. Check whether AADE is reachable.',
};

export function MydataPage() {
  const { data: m, isLoading, error } = useMydata();
  const [tab, setTab] = useState('review');

  // A receipt is linkable: the rides table, the customer card and anywhere else
  // showing a payment sends you here with ?receipt=<id>. Holding it in the URL
  // rather than only in state is what makes those links work, and what lets
  // someone paste "the one that failed" to a colleague.
  const [params, setParams] = useSearchParams();
  const openId = params.get('receipt');
  const setOpenId = (id: string | null) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set('receipt', id);
        else next.delete('receipt');
        return next;
      },
      { replace: true },
    );
  };

  const unreviewed = m ? m.issues.filter((i) => !i.reviewed_at).length : 0;

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader
        title="myDATA (AADE)"
        sub="Receipt transmission, review queue and manual corrections"
      />
      {error ? (
        <Card pad style={{ borderLeft: `3px solid ${colors.danger}` }}>
          <strong>Could not load myDATA state.</strong>
          <div style={{ marginTop: 4, fontSize: 13 }}>{mydataErrorMessage(error)}</div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
            An empty page here would read as "nothing to review", which is the one thing it must
            never say by accident.
          </div>
        </Card>
      ) : null}
      {isLoading || !m ? (
        <Card pad><Spinner /> Loading…</Card>
      ) : (
        <>
          <ModeBanner m={m} />
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: 'review', label: `Review queue${unreviewed ? ` (${unreviewed})` : ''}` },
              { key: 'submissions', label: 'All receipts' },
              { key: 'daily', label: 'Daily' },
              { key: 'series', label: 'Series & controls' },
            ]}
          />
          {tab === 'review' ? <ReviewQueue m={m} onOpen={setOpenId} /> : null}
          {tab === 'submissions' ? <Submissions m={m} onOpen={setOpenId} /> : null}
          {tab === 'daily' ? <Daily m={m} /> : null}
          {tab === 'series' ? <SeriesControls m={m} /> : null}
        </>
      )}
      <SubmissionDrawer id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

/* ────────────────────────────── mode ────────────────────────────── */

function ModeBanner({ m }: { m: MydataState }) {
  const live = m.mode === 'live';
  if (!m.enabled) {
    return (
      <Card pad style={{ borderLeft: `3px solid ${colors.danger}` }}>
        <strong>myDATA is switched off.</strong> No receipts are being numbered or recorded.
        Nothing reaches AADE.
      </Card>
    );
  }
  if (live) return null;
  return (
    <Card pad style={{ borderLeft: `3px solid ${colors.warning}` }}>
      <strong>{titleCase(m.mode.replace('_', ' '))} — nothing is being transmitted.</strong>{' '}
      Receipts are numbered and the documents are built, but they stop here. The old
      PythonAnywhere pipeline is still the system of record. Compare a few documents against
      what it filed before switching to live.
    </Card>
  );
}

/* ────────────────────────── review queue ────────────────────────── */

function ReviewQueue({ m, onOpen }: { m: MydataState; onOpen: (id: string) => void }) {
  const [kind, setKind] = useState<'all' | MydataIssueKind>('all');
  const [showReviewed, setShowReviewed] = useState(false);
  const [ackFor, setAckFor] = useState<MydataIssue | null>(null);
  const [issueFor, setIssueFor] = useState<MydataIssue | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const toast = useToast();
  const mutate = useMydataMutation();

  const act = (action: MydataAction, body: Record<string, unknown>, ok: string, done: () => void) =>
    mutate.mutate({ action, body }, {
      onSuccess: () => { toast.push(ok, 'success'); done(); },
      onError: (e) => toast.push(mydataErrorMessage(e), 'error'),
    });

  const all = m.issues.filter((i) => showReviewed || !i.reviewed_at);
  const rows = all.filter((i) => kind === 'all' || i.kind === kind);

  const byKind = useMemo(() => {
    const c = {} as Record<MydataIssueKind, number>;
    for (const i of all) c[i.kind] = (c[i.kind] ?? 0) + 1;
    return c;
  }, [all]);

  if (all.length === 0) {
    return (
      <Card pad style={{ borderLeft: `3px solid ${colors.success}` }}>
        <strong>Nothing to review.</strong> Every receipt is filed, every payment has one, and
        the series has no holes.
      </Card>
    );
  }

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <div className="row-wrap">
        {(Object.keys(ISSUE_LABEL) as MydataIssueKind[]).map((k) => (
          <button
            key={k}
            className="card stat-card"
            style={{
              flex: 1, minWidth: 160, textAlign: 'left', cursor: 'pointer',
              border: kind === k ? `1px solid ${colors.warning}` : undefined,
            }}
            onClick={() => setKind(kind === k ? 'all' : k)}
          >
            <span className="stat-label">{ISSUE_LABEL[k]}</span>
            <span style={{ fontSize: 20, fontWeight: 700, color: byKind[k] ? colors.danger : undefined }}>
              {byKind[k] ?? 0}
            </span>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader
          title={`${rows.length} to work through`}
          sub={kind === 'all' ? 'Highest severity first' : ISSUE_ACTION[kind]}
          actions={
            <>
              <Button size="sm" variant="ghost" onClick={() => setShowReviewed(!showReviewed)}>
                {showReviewed ? 'Hide reviewed' : 'Show reviewed'}
              </Button>
              {/* The imported history carries 578 gaps, 538 of them one
                  contiguous block from a single day. That is one decision, not
                  578 — demanding 578 clicks would get the queue abandoned. */}
              {kind === 'gap' && rows.length > 1 ? (
                <Button size="sm" onClick={() => setBulkOpen(true)}>Accept all shown</Button>
              ) : null}
              <Button
                size="sm"
                onClick={() =>
                  downloadCsv('mydata-issues', rows, [
                    { header: 'Kind', value: (i: MydataIssue) => i.kind },
                    { header: 'Severity', value: (i: MydataIssue) => i.severity },
                    { header: 'Series', value: (i: MydataIssue) => i.series ?? '' },
                    { header: 'AA', value: (i: MydataIssue) => i.aa ?? '' },
                    { header: 'Date', value: (i: MydataIssue) => i.issue_date ?? '' },
                    { header: 'Stripe', value: (i: MydataIssue) => i.stripe_charge_id ?? '' },
                    { header: 'Detail', value: (i: MydataIssue) => i.detail },
                  ])
                }
              >
                ⬇ CSV
              </Button>
            </>
          }
        />
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Problem</th><th>AA</th><th>Date</th><th>Amount</th><th>What happened</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((i, n) => (
                <tr key={`${i.kind}-${i.aa ?? i.stripe_charge_id ?? n}`}>
                  <td>
                    <Badge tone={i.severity === 'high' ? 'danger' : 'warning'}>{ISSUE_LABEL[i.kind]}</Badge>
                    {i.reviewed_at ? (
                      <span style={{ marginLeft: 6 }}><Badge tone="neutral" dot={false}>reviewed</Badge></span>
                    ) : null}
                  </td>
                  <td className="mono">{i.aa ?? '—'}</td>
                  <td>{i.issue_date ?? '—'}</td>
                  <td>{i.gross_cents === null ? '—' : formatMoney(i.gross_cents)}</td>
                  <td style={{ fontSize: 12, maxWidth: 460 }}>
                    {i.detail}
                    <div className="mono" style={{ color: 'var(--text-muted)', marginTop: 2 }}>
                      {i.stripe_charge_id ?? ''}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {/* Every row can be actioned. A queue entry with no button
                          can never leave the queue, and 94% of these have no
                          receipt row behind them once the history is imported. */}
                      {i.submission_id ? (
                        <Button size="sm" onClick={() => onOpen(i.submission_id!)}>Open</Button>
                      ) : null}
                      {i.kind === 'no_receipt' && i.stripe_charge_id ? (
                        <Button size="sm" variant="primary" onClick={() => setIssueFor(i)}>
                          Issue receipt
                        </Button>
                      ) : null}
                      {!i.reviewed_at ? (
                        <Button size="sm" variant="ghost" onClick={() => setAckFor(i)}>
                          {i.kind === 'gap' ? 'Accept' : 'Note'}
                        </Button>
                      ) : null}
                    </div>
                    {i.review_note ? (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, textAlign: 'right' }}>
                        {i.review_note}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Accept one issue — the honest action for a gap, where nothing can be
          fixed and the only question is whether somebody has looked. */}
      <ConfirmModal
        open={ackFor !== null}
        onClose={() => setAckFor(null)}
        onConfirm={(note) =>
          act(
            'ack_issue',
            { kind: ackFor?.kind, key: ackFor?.issue_key, note },
            'Noted — off the queue.',
            () => setAckFor(null),
          )
        }
        title={ackFor ? `${ISSUE_LABEL[ackFor.kind]} · ${ackFor.series ?? ''} ${ackFor.aa ?? ''}` : ''}
        message={
          ackFor?.kind === 'gap'
            ? 'This number was consumed by the old system and no document exists behind it. Nothing can be filed for it now — accepting records that it was reviewed and why.'
            : 'Takes this off the queue without changing anything about the filing itself.'
        }
        confirmLabel="Record"
        requireReason
        reasonLabel="What was decided"
        busy={mutate.isPending}
      />

      {/* Accept a whole range of gaps at once. */}
      <ConfirmModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onConfirm={(note) => {
          const aas = rows.map((r) => r.aa).filter((a): a is number => a != null);
          const series = rows.find((r) => r.series)?.series;
          if (!series || aas.length === 0) { setBulkOpen(false); return; }
          act(
            'ack_gap_range',
            { series, from: Math.min(...aas), to: Math.max(...aas), note },
            `Accepted ${aas.length} numbers.`,
            () => setBulkOpen(false),
          );
        }}
        title={`Accept ${rows.length} missing numbers`}
        message="Records one decision against every gap currently listed. They stay visible under “Show reviewed”."
        confirmLabel="Accept all"
        requireReason
        reasonLabel="What was decided"
        busy={mutate.isPending}
      />

      {/* Issue a receipt — the one queue entry with a real fix rather than an
          acknowledgement. */}
      <ConfirmModal
        open={issueFor !== null}
        onClose={() => setIssueFor(null)}
        onConfirm={() =>
          act(
            'issue_receipt',
            { payment_id: (issueFor?.issue_key ?? '').replace(/^payment:/, '') },
            'Receipt created and queued.',
            () => setIssueFor(null),
          )
        }
        title="Issue the missing receipt"
        message={
          issueFor
            ? `Creates a receipt for ${issueFor.gross_cents === null ? 'this payment' : formatMoney(issueFor.gross_cents)}, taking the next number in the series. It is built exactly as an automatic one would be, and follows the current mode — in practice mode it is still not sent.`
            : ''
        }
        confirmLabel="Issue receipt"
        busy={mutate.isPending}
      />
    </div>
  );
}

/* ───────────────────────── all submissions ──────────────────────── */

function Submissions({ m, onOpen }: { m: MydataState; onOpen: (id: string) => void }) {
  const [status, setStatus] = useState('all');
  const [source, setSource] = useState('all');
  const [q, setQ] = useState('');

  const rows = m.submissions.filter(
    (s) =>
      (status === 'all' || s.status === status) &&
      (source === 'all' || s.source === source) &&
      (!q ||
        String(s.aa).includes(q) ||
        (s.mark ?? '').includes(q) ||
        (s.stripe_charge_id ?? '').toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <Card>
      <CardHeader
        title={`Receipts (${rows.length.toLocaleString()}${
          m.totals.receipts > m.submissions.length ? ` of ${m.totals.receipts.toLocaleString()}` : ''
        })`}
        sub={
          m.totals.receipts > m.submissions.length
            ? `Showing the ${m.submissions.length.toLocaleString()} most recent numbers only — ` +
              `the filters below search these, not the full history yet.`
            : 'Imported history and everything this platform has issued'
        }
        actions={
          <Button
            size="sm"
            onClick={() =>
              downloadCsv('mydata-receipts', rows, [
                { header: 'Series', value: (s: MydataSubmission) => s.series },
                { header: 'AA', value: (s: MydataSubmission) => s.aa },
                { header: 'Date', value: (s: MydataSubmission) => s.issue_date },
                { header: 'Gross', value: (s: MydataSubmission) => s.gross_cents ?? '' },
                { header: 'Net', value: (s: MydataSubmission) => s.net_cents ?? '' },
                { header: 'VAT', value: (s: MydataSubmission) => s.vat_cents ?? '' },
                { header: 'Status', value: (s: MydataSubmission) => s.status },
                { header: 'MARK', value: (s: MydataSubmission) => s.mark ?? '' },
                { header: 'By hand', value: (s: MydataSubmission) => (s.filed_manually ? 'yes' : '') },
                { header: 'Charge', value: (s: MydataSubmission) => s.stripe_charge_id ?? '' },
                { header: 'Error', value: (s: MydataSubmission) => s.last_error ?? '' },
              ])
            }
          >
            ⬇ CSV
          </Button>
        }
      />
      <div className="card-pad" style={{ paddingBottom: 8 }}>
        <div className="toolbar">
          <Input
            style={{ maxWidth: 260 }}
            placeholder="AA, MARK or charge id…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Select style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            {['sent', 'pending', 'sending', 'failed', 'skipped', 'cancelled'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
          <Select style={{ width: 'auto' }} value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="all">Platform + imported</option>
            <option value="platform">Platform only</option>
            <option value="legacy">Imported history</option>
          </Select>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>AA</th><th>Date</th><th>Gross</th><th>Net</th><th>VAT</th>
              <th>Status</th><th>MARK</th><th>Charge</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td className="mono">
                  {s.aa}
                  {s.source === 'legacy' ? (
                    <span style={{ marginLeft: 6 }}><Badge tone="neutral" dot={false}>legacy</Badge></span>
                  ) : null}
                </td>
                <td>{s.issue_date}</td>
                <td>{s.gross_cents === null ? '—' : formatMoney(s.gross_cents)}</td>
                <td>{s.net_cents === null ? '—' : formatMoney(s.net_cents)}</td>
                <td>{s.vat_cents === null ? '—' : formatMoney(s.vat_cents)}</td>
                <td>
                  <Badge tone={STATUS_TONE[s.status]}>{titleCase(s.status)}</Badge>
                  {s.filed_manually ? (
                    <span style={{ marginLeft: 6 }}><Badge tone="info" dot={false}>by hand</Badge></span>
                  ) : null}
                </td>
                <td className="mono" style={{ fontSize: 12 }}>{s.mark ?? '—'}</td>
                <td className="mono" style={{ fontSize: 12 }}>{s.stripe_charge_id ?? '—'}</td>
                <td><Button size="sm" variant="ghost" onClick={() => onOpen(s.id)}>Open</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ──────────────────────────── daily ─────────────────────────────── */

function Daily({ m }: { m: MydataState }) {
  return (
    <Card>
      <CardHeader
        title="By day"
        sub="What used to arrive as a CSV by email the following morning"
        actions={
          <Button
            size="sm"
            onClick={() =>
              downloadCsv('mydata-daily', m.daily, [
                { header: 'Date', value: (d: MydataDailyRow) => d.issue_date },
                { header: 'Mode', value: (d: MydataDailyRow) => d.mode },
                { header: 'Receipts', value: (d: MydataDailyRow) => d.receipts },
                { header: 'Filed', value: (d: MydataDailyRow) => d.sent },
                { header: 'By hand', value: (d: MydataDailyRow) => d.filed_by_hand },
                { header: 'Failed', value: (d: MydataDailyRow) => d.failed },
                { header: 'Gross', value: (d: MydataDailyRow) => d.gross_cents },
                { header: 'Net', value: (d: MydataDailyRow) => d.net_cents },
                { header: 'VAT', value: (d: MydataDailyRow) => d.vat_cents },
                { header: 'AA from', value: (d: MydataDailyRow) => d.first_aa },
                { header: 'AA to', value: (d: MydataDailyRow) => d.last_aa },
              ])
            }
          >
            ⬇ CSV
          </Button>
        }
      />
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Date</th><th>Mode</th><th>Receipts</th><th>Filed</th><th>By hand</th>
              <th>Failed</th><th>Gross</th><th>Net</th><th>VAT</th><th>AA range</th>
            </tr>
          </thead>
          <tbody>
            {m.daily.map((d) => (
              <tr key={`${d.issue_date}-${d.mode}`}>
                <td>{d.issue_date}</td>
                <td><Badge tone={d.mode === 'live' ? 'success' : 'warning'} dot={false}>{d.mode}</Badge></td>
                <td>{d.receipts}</td>
                <td>{d.sent}</td>
                <td>{d.filed_by_hand || '—'}</td>
                <td style={{ color: d.failed ? colors.danger : undefined }}>{d.failed || '—'}</td>
                <td>{formatMoney(d.gross_cents)}</td>
                <td>{formatMoney(d.net_cents)}</td>
                <td>{formatMoney(d.vat_cents)}</td>
                <td className="mono" style={{ fontSize: 12 }}>{d.first_aa}–{d.last_aa}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ───────────────────── series, gaps and controls ────────────────── */

function SeriesControls({ m }: { m: MydataState }) {
  const toast = useToast();
  const mutate = useMydataMutation();
  const [askMode, setAskMode] = useState<string | null>(null);
  const s = m.series[0];

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <Card>
        <CardHeader title="Series" sub="Receipt numbering" />
        <div className="card-pad">
          <KV
            items={[
              ['Series', s?.series ?? '—'],
              ['Next receipt number', <span className="mono">{s?.next_aa ?? '—'}</span>],
              [
                'Floor',
                <span>
                  <span className="mono">{s?.floor_aa ?? '—'}</span>{' '}
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    — the lowest number this platform may issue. Anything below it was used by
                    the old system and can never be reissued.
                  </span>
                </span>,
              ],
              ['Active', s?.active ? 'yes' : 'no'],
            ]}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Transmission mode"
          sub="Receipts keep the mode they were created under, so switching never re-sends old ones"
        />
        <div className="card-pad">
          <div className="row-wrap">
            {(['dry_run', 'sandbox', 'live'] as const).map((mode) => (
              <button
                key={mode}
                className="card stat-card"
                style={{
                  flex: 1, minWidth: 200, textAlign: 'left', cursor: 'pointer',
                  border: m.mode === mode ? `1px solid ${colors.success}` : undefined,
                }}
                onClick={() => setAskMode(mode)}
                disabled={m.mode === mode}
              >
                <span className="stat-label">{titleCase(mode.replace('_', ' '))}</span>
                <span style={{ fontSize: 13 }}>
                  {mode === 'dry_run' ? 'Number and build the document, send nothing.' : null}
                  {mode === 'sandbox' ? "Send to AADE's development endpoint." : null}
                  {mode === 'live' ? 'File for real. The old pipeline must be off first.' : null}
                </span>
                {m.mode === mode ? (
                  <span style={{ marginTop: 6 }}><Badge tone="success" dot={false}>current</Badge></span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={`Holes in the series (${m.gaps.length})`}
          sub="Numbers with no document at AADE — all inherited from the old pipeline"
        />
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Series</th><th>AA</th><th>Why</th><th>Date</th></tr></thead>
            <tbody>
              {m.gaps.map((g: MydataGap) => (
                <tr key={`${g.series}-${g.aa}`}>
                  <td>{g.series}</td>
                  <td className="mono">{g.aa}</td>
                  <td><Badge tone="warning">{titleCase(g.reason.replace('_', ' '))}</Badge></td>
                  <td>{g.issue_date ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ConfirmModal
        open={askMode !== null}
        onClose={() => setAskMode(null)}
        onConfirm={(reason) =>
          mutate.mutate(
            { action: 'set_mode', body: { mode: askMode, reason } },
            {
              onSuccess: () => {
                toast.push(`myDATA is now in ${askMode} mode.`, askMode === 'live' ? 'error' : 'success');
                setAskMode(null);
              },
              // set_mode refuses to go live if the series would issue below its
              // floor. That refusal is the point — show it, do not close.
              onError: (e) => toast.push(mydataErrorMessage(e), 'error'),
            },
          )
        }
        busy={mutate.isPending}
        title={`Switch myDATA to ${askMode}`}
        message={
          askMode === 'live'
            ? 'This starts filing receipts at AADE for real. Confirm the PythonAnywhere pipeline has been disabled in Stripe — if both run, every charge is declared twice.'
            : 'Receipts already created keep their current mode. Only new ones are affected.'
        }
        confirmLabel={askMode === 'live' ? 'Go live' : 'Switch'}
        danger={askMode === 'live'}
        requireReason
        reasonLabel="Why (audit log)"
      />
    </div>
  );
}

/* ─────────────────────── one receipt in detail ──────────────────── */

function SubmissionDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const toast = useToast();
  const { data, isLoading, error } = useMydataDetail(id);
  const mutate = useMydataMutation();
  const [markOpen, setMarkOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [mark, setMark] = useState('');
  const [note, setNote] = useState('');

  if (!id) return null;

  const run = (action: MydataAction, body: Record<string, unknown>, ok: string, after?: () => void) => {
    mutate.mutate(
      { action, body: { id, ...body } },
      {
        onSuccess: () => { toast.push(ok, 'success'); after?.(); },
        // Business-rule rejections come back here: already filed, a MARK that
        // belongs to another receipt, a floor violation. Show the reason.
        onError: (e) => toast.push(mydataErrorMessage(e), 'error'),
      },
    );
  };

  if (isLoading || !data) {
    return (
      <Drawer open onClose={onClose} title="Receipt">
        {error ? (
          <Card pad style={{ borderLeft: `3px solid ${colors.danger}` }}>
            {mydataErrorMessage(error)}
          </Card>
        ) : (
          <div><Spinner /> Loading…</div>
        )}
      </Drawer>
    );
  }

  const row = data.row;
  const payment = data.payment;
  const canAct = row.status !== 'sent' && row.source === 'platform';

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={
          <span>
            {row.series} <span className="mono">{row.aa}</span>{' '}
            <Badge tone={STATUS_TONE[row.status]}>{titleCase(row.status)}</Badge>
            {row.filed_manually ? (
              <span style={{ marginLeft: 6 }}><Badge tone="info" dot={false}>filed by hand</Badge></span>
            ) : null}
          </span>
        }
        footer={
          <>
            <Button onClick={onClose}>Close</Button>
            <Button onClick={() => setNoteOpen(true)} disabled={mutate.isPending}>Note as reviewed</Button>
            {canAct ? (
              <>
                <Button
                  onClick={() => { setMark(''); setNote(''); setMarkOpen(true); }}
                  disabled={mutate.isPending}
                >
                  Record a MARK filed by hand
                </Button>
                <Button
                  variant="primary"
                  disabled={mutate.isPending}
                  onClick={() => run('retry', {}, `AA ${row.aa} requeued — it keeps the same number.`)}
                >
                  {mutate.isPending ? 'Working…' : 'Retry'}
                </Button>
              </>
            ) : null}
          </>
        }
      >
        <div className="stack" style={{ gap: 'var(--space-md)' }}>
          {row.status === 'failed' ? (
            <Card pad style={{ borderLeft: `3px solid ${colors.danger}` }}>
              <strong>Why it failed</strong>
              <div style={{ marginTop: 4 }}>{row.last_error}</div>
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                {(row.last_error ?? '').startsWith('blocked by control')
                  ? 'A control stopped this before it was sent. Nothing reached AADE — check the amount is real, then retry or file it by hand.'
                  : 'Retry only helps if the cause was transient. A rejection will be rejected again; file it on the AADE portal and record the MARK here.'}
              </div>
            </Card>
          ) : null}

          {row.review_note ? (
            <Card pad style={{ borderLeft: `3px solid ${colors.success}` }}>
              <strong>Reviewer's note</strong>
              <div style={{ marginTop: 4 }}>{row.review_note}</div>
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                {row.reviewed_by ?? 'unknown'} · {row.reviewed_at ? formatDateTime(row.reviewed_at) : '—'}
              </div>
            </Card>
          ) : null}

          <KV
            items={[
              ['Issue date', row.issue_date],
              ['Gross', row.gross_cents === null ? '— (not recorded by the old system)' : formatMoney(row.gross_cents)],
              ['Net', row.net_cents === null ? '—' : formatMoney(row.net_cents)],
              ['VAT', row.vat_cents === null ? '—' : formatMoney(row.vat_cents)],
              ['MARK', <span className="mono">{row.mark ?? '—'}</span>],
              ['Stripe charge', <span className="mono">{row.stripe_charge_id ?? '—'}</span>],
              // Links back out to the ride and the rider. A receipt that is a
              // dead end makes you search for the trip by hand, which is exactly
              // the "separate system" feeling this is meant to remove.
              [
                'Ride',
                payment?.trip_id
                  ? <Link to={`/rides/${payment.trip_id}`} className="mono">{shortId(payment.trip_id)}</Link>
                  : <span className="muted">— not from a ride</span>,
              ],
              [
                'Rider',
                payment?.user_id
                  ? <Link to={`/customers/${payment.user_id}`} className="mono">{shortId(payment.user_id)}</Link>
                  : <span className="muted">—</span>,
              ],
              ['Payment', <span className="mono">{row.payment_id ?? '—'}</span>],
              ['Mode', row.mode],
              ['Source', row.source === 'legacy' ? 'imported from PythonAnywhere' : 'this platform'],
              ['Attempts', row.attempts],
              ['Created', `${formatDateTime(row.created_at)} (${relativeTime(row.created_at)})`],
              ['Sent', row.sent_at ? formatDateTime(row.sent_at) : '—'],
            ]}
          />

          {row.request_xml ? (
            <div>
              <strong style={{ fontSize: 13 }}>Document sent to AADE</strong>
              <pre className="mono" style={preStyle}>{row.request_xml}</pre>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              No document stored — the old pipeline overwrote a single file on every run, so
              nothing survives for imported receipts.
            </div>
          )}

          {row.response_body ? (
            <div>
              <strong style={{ fontSize: 13 }}>AADE response</strong>
              <pre className="mono" style={preStyle}>{row.response_body}</pre>
            </div>
          ) : null}

          {data.payment ? (
            <div>
              <strong style={{ fontSize: 13 }}>The payment behind it</strong>
              <KV
                items={[
                  ['Amount', formatMoney(data.payment.amount_cents)],
                  ['Kind', titleCase(data.payment.kind)],
                  ['Status', titleCase(data.payment.status)],
                  ['Taken', formatDateTime(data.payment.created_at)],
                ]}
              />
            </div>
          ) : null}

          {data.audit.length ? (
            <div>
              <strong style={{ fontSize: 13 }}>What has been done to it</strong>
              <table className="data" style={{ marginTop: 6 }}>
                <tbody>
                  {data.audit.map((a, i) => (
                    <tr key={`${a.action}-${i}`}>
                      <td style={{ fontSize: 12 }}>{a.action.replace('mydata.', '')}</td>
                      <td style={{ fontSize: 12 }}>{a.reason ?? '—'}</td>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{formatDateTime(a.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </Drawer>

      <Modal
        open={markOpen}
        onClose={() => setMarkOpen(false)}
        title="Record a MARK filed by hand"
        footer={
          <>
            <Button onClick={() => setMarkOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!/^\d+$/.test(mark.trim()) || note.trim().length < 3 || mutate.isPending}
              onClick={() =>
                run(
                  'mark_filed',
                  { mark: mark.trim(), note: note.trim() },
                  `MARK ${mark.trim()} recorded against AA ${row.aa}.`,
                  () => setMarkOpen(false),
                )
              }
            >
              {mutate.isPending ? 'Working…' : 'Record'}
            </Button>
          </>
        }
      >
        <p style={{ marginTop: 0 }}>
          Use this after filing the receipt through the AADE portal yourself. It marks the
          receipt as filed and takes it off the review queue, without claiming the platform
          transmitted it.
        </p>
        <Field label="MARK from AADE" required hint="Digits only — copy it from the AADE response.">
          <Input value={mark} onChange={(e) => setMark(e.target.value)} placeholder="400014861204773" />
        </Field>
        <Field label="What you did" required hint="Recorded in the audit log against this receipt.">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. AADE rejected the automatic submission as a duplicate aa; filed through the portal instead."
          />
        </Field>
      </Modal>

      <ConfirmModal
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        onConfirm={(reason) =>
          run('review', { note: reason }, 'Noted as reviewed.', () => setNoteOpen(false))
        }
        title="Note as reviewed"
        message="Takes this off the queue without changing whether it was filed. Use it for things that are known and accepted."
        confirmLabel="Save note"
        requireReason
        reasonLabel="Note"
        busy={mutate.isPending}
      />
    </>
  );
}

const preStyle = {
  background: 'var(--surface-2, rgba(127,127,127,0.08))',
  padding: 12,
  borderRadius: 8,
  fontSize: 11,
  lineHeight: 1.45,
  overflowX: 'auto' as const,
  whiteSpace: 'pre' as const,
  margin: '6px 0 0',
};
