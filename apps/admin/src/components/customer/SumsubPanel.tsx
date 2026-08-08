import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDS } from '@/context/DataContext';
import { useToast } from '@/components/ui/Toast';
import { Card, CardHeader, Button, KV, Spinner } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { formatDateTime, formatDate, relativeTime, titleCase } from '@/lib/format';
import { colors } from '@penny/ui';
import type { SumsubDocument, SumsubProfile, SumsubProfileBundle, SumsubReviewEvent } from '@/types/domain';

const SUMSUB_DASHBOARD = 'https://cockpit.sumsub.com/checkus#/applicant';

/* ---------------------------------------------------------------- */
/* Review status banner                                              */
/* ---------------------------------------------------------------- */

function bannerFor(a: SumsubProfile): { tone: 'success' | 'danger' | 'warning' | 'info'; title: string; sub: string } {
  if (a.review_answer === 'GREEN') {
    return { tone: 'success', title: 'GREEN — approved', sub: `Verified identity. Reviewed ${a.reviewed_at ? relativeTime(a.reviewed_at) : 'recently'}.` };
  }
  if (a.review_answer === 'RED') {
    return a.review_reject_type === 'FINAL'
      ? { tone: 'danger', title: 'RED — FINAL rejection', sub: 'Permanent. The rider cannot re-submit; a new applicant requires compliance sign-off.' }
      : { tone: 'warning', title: 'RED — RETRY requested', sub: 'The rider can re-submit the flagged documents from the app.' };
  }
  if (a.review_status === 'onHold') {
    return { tone: 'warning', title: 'On hold', sub: 'Sumsub paused the review — usually a sanctions/PEP hit awaiting manual clearance.' };
  }
  return { tone: 'info', title: `Pending — ${a.review_status}`, sub: 'Sumsub has not returned a decision yet. Nothing to action.' };
}

const TONE_COLOR = { success: colors.success, danger: colors.danger, warning: colors.warning, info: colors.primary } as const;

function Banner({ tone, title, sub, children }: { tone: keyof typeof TONE_COLOR; title: string; sub: string; children?: React.ReactNode }) {
  const c = TONE_COLOR[tone];
  return (
    <div className="banner" style={{ borderColor: c, background: `${c}12` }}>
      <div className="banner-bar" style={{ background: c }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: c, fontSize: 'var(--fs-lg)' }}>{title}</div>
        <div className="muted" style={{ marginTop: 2 }}>{sub}</div>
        {children}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Document gallery + lightbox                                       */
/* ---------------------------------------------------------------- */

function docTitle(d: SumsubDocument): string {
  return `${titleCase(d.doc_type.toLowerCase())}${d.doc_sub_type ? ` · ${titleCase(d.doc_sub_type.toLowerCase())}` : ''}`;
}

function DocumentLightbox({
  docs, index, onClose, onIndex,
}: { docs: SumsubDocument[]; index: number; onClose: () => void; onIndex: (i: number) => void }) {
  const [zoom, setZoom] = useState(1);
  const doc = docs[index];

  useEffect(() => { setZoom(1); }, [index]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') onIndex((index + 1) % docs.length);
      if (e.key === 'ArrowLeft') onIndex((index - 1 + docs.length) % docs.length);
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)));
      if (e.key === '-') setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, docs.length, onIndex]);

  if (!doc) return null;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={<span>{docTitle(doc)} <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>· {index + 1} / {docs.length}</span></span>}
      footer={
        <>
          <Button onClick={() => onIndex((index - 1 + docs.length) % docs.length)} disabled={docs.length < 2}>‹ Previous</Button>
          <Button onClick={() => onIndex((index + 1) % docs.length)} disabled={docs.length < 2}>Next ›</Button>
          <div style={{ flex: 1 }} />
          <Button size="sm" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>−</Button>
          <span className="mono" style={{ fontSize: 12, minWidth: 46, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <Button size="sm" onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}>+</Button>
          <Button size="sm" variant="ghost" onClick={() => setZoom(1)}>Reset</Button>
        </>
      }
    >
      <div className="lightbox-stage">
        <img src={doc.url} alt={docTitle(doc)} style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }} />
      </div>
      <div style={{ marginTop: 'var(--space-md)' }}>
        <KV items={[
          ['Type', docTitle(doc)],
          ['Country', doc.country ?? '—'],
          ['Valid until', doc.valid_until ? formatDate(doc.valid_until) : '—'],
          ['Review answer', doc.review_answer ? <Badge tone={doc.review_answer === 'GREEN' ? 'success' : 'danger'}>{doc.review_answer}</Badge> : <span className="muted">Not reviewed</span>],
          ['Reject labels', doc.reject_labels.length ? <span className="row-wrap">{doc.reject_labels.map((l) => <Badge key={l} tone="danger">{l}</Badge>)}</span> : '—'],
          ['Image id', <span className="mono">{doc.image_id}</span>],
          ['Uploaded', doc.added_at ? formatDateTime(doc.added_at) : '—'],
          ['Content type', <span className="mono">{doc.content_type}</span>],
        ]} />
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Images are streamed from Sumsub through the edge function and never persisted in Penny storage (Hard Rule #11).
        </p>
      </div>
    </Modal>
  );
}

function DocumentGallery({ docs }: { docs: SumsubDocument[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (docs.length === 0) return <EmptyState emoji="🗂" title="No documents uploaded" hint="The applicant exists but has not submitted any images yet." />;
  return (
    <>
      <div className="doc-grid">
        {docs.map((d, i) => (
          <button key={d.image_id} type="button" className="doc-card" onClick={() => setOpen(i)}>
            <div className="doc-thumb">
              <img src={d.url} alt={docTitle(d)} loading="lazy" />
              {d.review_answer === 'RED' ? <span className="doc-flag" style={{ background: colors.danger }}>RED</span> : null}
              {d.review_answer === 'GREEN' ? <span className="doc-flag" style={{ background: colors.success }}>GREEN</span> : null}
            </div>
            <div className="doc-meta">
              <div style={{ fontWeight: 600 }}>{docTitle(d)}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {d.country ?? '—'}{d.valid_until ? ` · valid to ${d.valid_until}` : ''}
              </div>
              {d.reject_labels.length ? (
                <div className="row-wrap" style={{ gap: 4, marginTop: 4 }}>
                  {d.reject_labels.map((l) => <Badge key={l} tone="danger">{l}</Badge>)}
                </div>
              ) : null}
            </div>
          </button>
        ))}
      </div>
      {open !== null ? <DocumentLightbox docs={docs} index={open} onIndex={setOpen} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

/* ---------------------------------------------------------------- */
/* Review history                                                    */
/* ---------------------------------------------------------------- */

function ReviewHistory({ history }: { history: SumsubReviewEvent[] }) {
  if (history.length === 0) return <EmptyState title="No review history" />;
  return (
    <div className="timeline">
      {[...history].reverse().map((h, i) => {
        const tone = h.review_answer === 'GREEN' ? colors.success : h.review_answer === 'RED' ? colors.danger : colors.primary;
        return (
          <div key={`${h.at}-${i}`} className="timeline-item">
            <div className="between" style={{ alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 600 }}>
                {titleCase(h.review_status)}
                {h.review_answer ? <span style={{ color: tone }}> · {h.review_answer}</span> : null}
              </div>
              <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{formatDateTime(h.at)}</span>
            </div>
            {h.reject_labels.length ? (
              <div className="row-wrap" style={{ gap: 4, margin: '4px 0' }}>
                {h.reject_labels.map((l) => <Badge key={l} tone="danger">{l}</Badge>)}
              </div>
            ) : null}
            {h.moderation_comment ? <div className="muted" style={{ fontSize: 12 }}>{h.moderation_comment}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Panel                                                             */
/* ---------------------------------------------------------------- */

export function SumsubPanel({ userId, kycStatus, onForceRekyc }: { userId: string; kycStatus: string; onForceRekyc: () => void }) {
  const ds = useDS();
  const qc = useQueryClient();
  const toast = useToast();

  const { data, isLoading, isError, error } = useQuery<SumsubProfileBundle>({
    queryKey: ['sumsub', userId],
    queryFn: () => ds.getSumsubProfile(userId),
  });

  const resync = useMutation({
    mutationFn: () => ds.getSumsubProfile(userId, { refresh: true }),
    onSuccess: (fresh) => {
      qc.setQueryData(['sumsub', userId], fresh);
      toast.push('Re-synced from Sumsub (audited)', 'success');
    },
    onError: () => toast.push('Sumsub re-sync failed', 'error'),
  });

  const applicant = data?.applicant ?? null;
  const banner = useMemo(() => (applicant ? bannerFor(applicant) : null), [applicant]);

  const headerActions = (
    <>
      {data ? (
        <span className="chip" title={`Fetched ${formatDateTime(data.fetched_at)}`}>
          <span className="dot" style={{ width: 7, height: 7, borderRadius: 999, background: data.source === 'live' ? colors.success : colors.textMuted }} />
          {data.source === 'live' ? 'Live' : 'Cached'} · {relativeTime(data.fetched_at)}
        </span>
      ) : null}
      <Button size="sm" disabled={resync.isPending} onClick={() => resync.mutate()}>
        {resync.isPending ? <><Spinner size={12} /> Syncing…</> : '↻ Re-sync from Sumsub'}
      </Button>
      <a
        className="btn btn-sm"
        href={applicant ? `${SUMSUB_DASHBOARD}/${applicant.applicant_id}` : SUMSUB_DASHBOARD}
        target="_blank"
        rel="noreferrer"
      >
        Open in Sumsub ↗
      </a>
    </>
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader title="KYC · Sumsub" sub="Loading applicant from the provider…" actions={headerActions} />
        <div className="card-pad stack" style={{ gap: 14 }}>
          <Skeleton height={72} />
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Skeleton height={190} /><Skeleton height={190} />
          </div>
          <div className="doc-grid">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={190} />)}
          </div>
        </div>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader title="KYC · Sumsub" actions={headerActions} />
        <ErrorState message={error instanceof Error ? error.message : 'Could not reach the sumsub-applicant edge function.'} />
      </Card>
    );
  }

  if (!applicant) {
    return (
      <Card>
        <CardHeader title="KYC · Sumsub" sub="No applicant linked to this user" actions={headerActions} />
        <EmptyState
          emoji="🪪"
          title="No Sumsub applicant"
          hint={
            kycStatus === 'none'
              ? 'This rider has never started verification. Riding is blocked until KYC completes if the city requires it.'
              : 'The user has a KYC status but no applicant id — likely a legacy Atom account that was migrated without a Sumsub link (docs/09).'
          }
          action={<Button variant="primary" onClick={onForceRekyc}>Request KYC from rider</Button>}
        />
      </Card>
    );
  }

  const fullName = [applicant.first_name, applicant.middle_name, applicant.last_name].filter(Boolean).join(' ');

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <Card>
        <CardHeader
          title="KYC · Sumsub"
          sub={<>Applicant <span className="mono">{applicant.applicant_id}</span> · level <b>{applicant.level}</b></>}
          actions={headerActions}
        />
        <div className="card-pad stack" style={{ gap: 'var(--space-lg)' }}>
          {banner ? (
            <Banner tone={banner.tone} title={banner.title} sub={banner.sub}>
              {applicant.reject_labels.length ? (
                <div className="row-wrap" style={{ gap: 6, marginTop: 10 }}>
                  {applicant.reject_labels.map((l) => <Badge key={l} tone={applicant.review_reject_type === 'FINAL' ? 'danger' : 'warning'}>{l}</Badge>)}
                </div>
              ) : null}
              {applicant.moderation_comment ? (
                <blockquote className="quote">{applicant.moderation_comment}</blockquote>
              ) : null}
              {applicant.client_comment ? (
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}><b>Internal:</b> {applicant.client_comment}</div>
              ) : null}
            </Banner>
          ) : null}

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            <div>
              <h4 className="section-label">Extracted identity</h4>
              <KV items={[
                ['Full name', fullName || '—'],
                ['Date of birth', applicant.dob ? formatDate(applicant.dob) : '—'],
                ['Gender', applicant.gender ?? '—'],
                ['Nationality', applicant.nationality ?? '—'],
                ['Country', applicant.country ?? '—'],
                ['Place of birth', applicant.place_of_birth ?? '—'],
                ['Phone', <span className="mono">{applicant.phone ?? '—'}</span>],
                ['Email', applicant.email ?? '—'],
              ]} />
            </div>
            <div>
              <h4 className="section-label">Document & review</h4>
              <KV items={[
                ['Doc type', applicant.id_doc_type ? titleCase(applicant.id_doc_type.toLowerCase()) : '—'],
                ['Doc number', <span className="mono">{applicant.id_doc_number ?? '—'}</span>],
                ['Doc expiry', applicant.id_doc_expiry ? formatDate(applicant.id_doc_expiry) : '—'],
                ['Doc country', applicant.id_doc_country ?? '—'],
                ['Review status', <Badge tone={applicant.review_status === 'completed' ? 'success' : 'warning'}>{titleCase(applicant.review_status)}</Badge>],
                ['Review answer', applicant.review_answer ? <Badge tone={applicant.review_answer === 'GREEN' ? 'success' : 'danger'}>{applicant.review_answer}</Badge> : <span className="muted">pending</span>],
                ['Reject type', applicant.review_reject_type ?? '—'],
                ['Inspection id', <span className="mono">{applicant.inspection_id ?? '—'}</span>],
                ['External user id', <span className="mono">{applicant.external_user_id ?? '—'}</span>],
                ['Applicant created', formatDateTime(applicant.applicant_created_at)],
                ['Reviewed at', formatDateTime(applicant.reviewed_at)],
              ]} />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={`Documents (${data?.documents.length ?? 0})`} sub="Click a thumbnail to open the lightbox — ← → to page, +/− to zoom" />
        <div className="card-pad">
          <DocumentGallery docs={data?.documents ?? []} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Review history" sub="Every status change returned by Sumsub webhooks" />
        <div className="card-pad">
          <ReviewHistory history={data?.history ?? []} />
        </div>
      </Card>
    </div>
  );
}
