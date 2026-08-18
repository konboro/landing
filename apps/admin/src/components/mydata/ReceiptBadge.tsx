// One vocabulary for "did the tax office get told about this?", used by the
// rides table, the ride page, the customer card and the dashboard.
//
// It lives in one component on purpose. The moment two screens describe the
// same receipt differently, the panel stops being trustworthy about tax — and
// the difference that matters most is the least obvious one: a receipt built in
// practice mode LOOKS complete in the database (it has a number, an amount and
// a document) but has never reached AADE. It must never read as done.
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import type { ReceiptState } from '@/types/domain';

type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

interface Look {
  label: string;
  tone: Tone;
  /** Shown on hover — says what the state means, not what it is called. */
  hint: string;
}

const LOOK: Record<ReceiptState, Look> = {
  filed: {
    label: 'Filed',
    tone: 'success',
    hint: 'Sent to AADE and accepted. The MARK is recorded.',
  },
  in_flight: {
    label: 'Sending',
    tone: 'warning',
    hint: 'Queued or retrying. No action needed yet.',
  },
  failed: {
    label: 'Not filed',
    tone: 'danger',
    hint: 'AADE rejected it or it could not be sent. Needs a person.',
  },
  practice: {
    label: 'Practice',
    tone: 'neutral',
    hint: 'Built while the system was in practice mode — never sent to AADE. The old pipeline filed this one.',
  },
  not_filed: {
    label: 'Not filed',
    tone: 'warning',
    hint: 'A receipt exists but was deliberately not transmitted.',
  },
  missing: {
    label: 'No receipt',
    tone: 'danger',
    hint: 'Money was taken and no receipt exists at all.',
  },
  not_chargeable: {
    label: '—',
    tone: 'neutral',
    hint: 'No completed charge, so no receipt is due.',
  },
  unknown: {
    label: 'Unknown',
    tone: 'warning',
    hint: 'The receipt is in a state the panel does not recognise.',
  },
};

export function ReceiptBadge({
  state,
  aa,
  filedManually,
  submissionId,
  compact,
}: {
  state: ReceiptState;
  aa?: number | null;
  filedManually?: boolean | null;
  /** When present, the badge links through to the receipt on the myDATA page. */
  submissionId?: string | null;
  compact?: boolean;
}) {
  const look = LOOK[state] ?? LOOK.unknown;

  const badge = (
    <span title={look.hint} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Badge tone={look.tone}>{look.label}</Badge>
      {!compact && aa ? (
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>#{aa}</span>
      ) : null}
      {filedManually ? (
        <span title="Filed by hand on the AADE portal, not by this system.">
          <Badge tone="info" dot={false}>by hand</Badge>
        </span>
      ) : null}
    </span>
  );

  // Deep-linking only makes sense when there is something to open. A ride with
  // no charge should not offer a link to nothing.
  if (!submissionId) return badge;
  return (
    <Link to={`/mydata?receipt=${submissionId}`} style={{ textDecoration: 'none' }}>
      {badge}
    </Link>
  );
}

/** Does this state want a human? Drives counts and emphasis, so it is defined once. */
export function receiptNeedsAttention(state: ReceiptState): boolean {
  return state === 'failed' || state === 'missing' || state === 'unknown';
}
