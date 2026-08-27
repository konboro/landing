import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDS } from '@/context/DataContext';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { useTableState } from '@/hooks/useTableState';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader, Button, Field, Input, Select, Textarea, Checkbox, Divider } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/Badge';
import { ConfirmModal } from '@/components/ui/Modal';
import { formatDateTime, relativeTime, titleCase } from '@/lib/format';
import type { BroadcastAudience, BroadcastChannel, BroadcastInput, BroadcastResult } from '@/data/api';
import type { BroadcastRow, CustomerRow } from '@/types/domain';

const CHANNELS: Array<{ key: BroadcastChannel; label: string; hint: string }> = [
  { key: 'inbox', label: 'In-app notification', hint: 'Waits in the rider’s message centre. Nothing is interrupted.' },
  { key: 'popup', label: 'Pop-up', hint: 'Modal on the next app open, until dismissed or expired.' },
  { key: 'push', label: 'Push', hint: 'Expo push to every registered device. Needs the app installed and permission granted.' },
];

export function NotificationsPage() {
  const { can } = useAuth();
  if (!can('notifications.send')) {
    return (
      <div>
        <PageHeader title="Notifications" sub="Send to everyone, a group, or named riders" />
        <Card><div className="card-pad muted">Your role cannot send notifications.</div></Card>
      </div>
    );
  }
  return <NotificationsConsole />;
}

function NotificationsConsole() {
  const ds = useDS();
  const qc = useQueryClient();
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [deepLink, setDeepLink] = useState('');
  const [channels, setChannels] = useState<BroadcastChannel[]>(['inbox']);
  const [category, setCategory] = useState<'transactional' | 'marketing'>('transactional');
  const [audienceKind, setAudienceKind] = useState<'all' | 'group' | 'users'>('all');
  const [groupId, setGroupId] = useState('');
  const [picked, setPicked] = useState<CustomerRow[]>([]);
  const [expiresAt, setExpiresAt] = useState('');
  const [reason, setReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preview, setPreview] = useState<BroadcastResult | null>(null);

  const { data: groups } = useQuery({ queryKey: ['customer-groups'], queryFn: () => ds.listCustomerGroups() });

  const audience: BroadcastAudience = useMemo(() => {
    if (audienceKind === 'group') return { kind: 'group', group_id: groupId };
    if (audienceKind === 'users') return { kind: 'users', user_ids: picked.map((p) => p.id) };
    return { kind: 'all' };
  }, [audienceKind, groupId, picked]);

  const input: BroadcastInput = {
    title: title.trim(),
    body: body.trim(),
    deep_link: deepLink.trim() || null,
    channels,
    category,
    audience,
    expires_at: channels.includes('popup') && expiresAt ? new Date(expiresAt).toISOString() : null,
    reason: reason.trim() || undefined,
  };

  // One person is a message; everyone is a campaign. Only the second needs a
  // written reason, and the server enforces the same rule.
  const massSend = audienceKind !== 'users' || picked.length > 1;
  const needsTitle = channels.includes('popup') || channels.includes('push');
  const audienceReady =
    audienceKind === 'all' || (audienceKind === 'group' && !!groupId) || (audienceKind === 'users' && picked.length > 0);
  const problems: string[] = [];
  if (!body.trim()) problems.push('Message body is empty.');
  if (needsTitle && !title.trim()) problems.push('Pop-up and push need a title.');
  if (!channels.length) problems.push('Pick at least one channel.');
  if (!audienceReady) problems.push('Pick an audience.');
  if (massSend && reason.trim().length < 3) problems.push('A reason is required when messaging more than one person.');
  const ready = problems.length === 0;

  const dryRun = useMutation({
    mutationFn: () => ds.previewBroadcast(input),
    onSuccess: (r) => setPreview(r),
    onError: (e) => toast.push(e instanceof Error ? e.message : 'Preview failed', 'error'),
  });

  const send = useMutation({
    mutationFn: () => ds.sendBroadcast(input),
    onSuccess: (r) => {
      const bits = [`${r.recipients} recipient(s)`];
      if (r.push_sent) bits.push(`${r.push_sent} push`);
      if (r.push_failed) bits.push(`${r.push_failed} push failed`);
      toast.push(`Sent — ${bits.join(', ')}`, r.push_failed ? 'info' : 'success');
      if (r.errors?.length) toast.push(r.errors[0]!, 'error');
      setConfirmOpen(false);
      setTitle(''); setBody(''); setDeepLink(''); setReason(''); setPreview(null); setPicked([]);
      qc.invalidateQueries({ queryKey: ['broadcasts'] });
    },
    onError: (e) => { toast.push(e instanceof Error ? e.message : 'Send failed', 'error'); setConfirmOpen(false); },
  });

  const toggleChannel = (c: BroadcastChannel) =>
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const audienceLabel =
    audienceKind === 'all' ? 'everyone (active riders)'
      : audienceKind === 'group' ? `group “${groups?.find((g) => g.id === groupId)?.name ?? '—'}”`
        : `${picked.length} selected rider(s)`;

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <PageHeader title="Notifications" sub="One message → in-app inbox, pop-up and push. Everyone, a group, or named riders." />

      <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        <Card>
          <CardHeader title="Compose" sub="Delivery is logged per recipient; marketing sends are consent-filtered server-side." />
          <div className="card-pad stack" style={{ gap: 'var(--space-md)' }}>
            <Field label="Title" hint={needsTitle ? 'Required for pop-up and push.' : 'Shown as the headline in the message centre.'}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Service update" maxLength={80} />
            </Field>
            <Field label="Message" required hint={`${body.length}/500`}>
              <Textarea value={body} onChange={(e) => setBody(e.target.value.slice(0, 500))} rows={4} placeholder="What riders need to know…" />
            </Field>
            <Field label="Deep link" hint="Opens a screen in the app, e.g. penny://wallet. Optional.">
              <Input className="mono" value={deepLink} onChange={(e) => setDeepLink(e.target.value)} placeholder="penny://wallet" />
            </Field>

            <Divider />

            <div className="stack" style={{ gap: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Channels</span>
              {CHANNELS.map((c) => (
                <div key={c.key}>
                  <Checkbox label={c.label} checked={channels.includes(c.key)} onChange={() => toggleChannel(c.key)} />
                  <div className="muted" style={{ fontSize: 12, marginLeft: 26 }}>{c.hint}</div>
                </div>
              ))}
            </div>

            {channels.includes('popup') ? (
              <Field label="Pop-up stops showing after" hint="Leave empty to keep showing until dismissed.">
                <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              </Field>
            ) : null}

            <Field label="Category" hint="Marketing is filtered against each rider’s consent; transactional is not, so use it only for things riders must see.">
              <Select value={category} onChange={(e) => setCategory(e.target.value as 'transactional' | 'marketing')}>
                <option value="transactional">Transactional (service info)</option>
                <option value="marketing">Marketing (consent required)</option>
              </Select>
            </Field>
          </div>
        </Card>

        <div className="stack" style={{ gap: 'var(--space-lg)' }}>
          <Card>
            <CardHeader title="Audience" />
            <div className="card-pad stack" style={{ gap: 'var(--space-md)' }}>
              <Select value={audienceKind} onChange={(e) => { setAudienceKind(e.target.value as typeof audienceKind); setPreview(null); }}>
                <option value="all">Everyone (active riders)</option>
                <option value="group">Customer group</option>
                <option value="users">Named riders</option>
              </Select>

              {audienceKind === 'group' ? (
                <Field label="Group">
                  <Select value={groupId} onChange={(e) => { setGroupId(e.target.value); setPreview(null); }}>
                    <option value="">— pick a group —</option>
                    {(groups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name} ({g.members})</option>)}
                  </Select>
                </Field>
              ) : null}

              {audienceKind === 'users' ? <UserPicker picked={picked} onChange={(p) => { setPicked(p); setPreview(null); }} /> : null}

              <Button onClick={() => dryRun.mutate()} disabled={!audienceReady || dryRun.isPending}>
                {dryRun.isPending ? 'Checking…' : 'Check reach'}
              </Button>
              {preview ? (
                <div className="stack" style={{ gap: 4, fontSize: 13 }}>
                  <div className="between"><span>Recipients</span><b>{preview.recipients}</b></div>
                  {channels.map((c) => (
                    <div className="between" key={c}><span>{titleCase(c)}</span><b>{preview.reach?.[c] ?? 0}</b></div>
                  ))}
                  {channels.includes('push') && !preview.push_devices ? (
                    <Badge tone="warning">No registered devices — push will reach nobody yet</Badge>
                  ) : null}
                  {category === 'marketing' && preview.recipients === 0 ? (
                    <Badge tone="warning">Nobody in this audience consented to marketing</Badge>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="Preview" sub="How the pop-up reads on a phone" />
            <div className="card-pad">
              <PhonePreview title={title} body={body} />
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <div className="card-pad stack" style={{ gap: 'var(--space-md)' }}>
          <Field label="Reason" required={massSend} hint="Written to the audit log with who sent it and to whom.">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this goes out" />
          </Field>
          {problems.length ? (
            <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          ) : null}
          <div className="row" style={{ gap: 8 }}>
            <Button variant="primary" disabled={!ready || send.isPending} onClick={() => setConfirmOpen(true)}>
              Send now
            </Button>
          </div>
        </div>
      </Card>

      <History />

      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => send.mutate()}
        title="Send this out?"
        message={`“${title || body.slice(0, 40)}” goes to ${audienceLabel} via ${channels.join(' + ')}${preview ? ` — ${preview.recipients} recipient(s)` : ''}. This cannot be recalled.`}
        danger={audienceKind === 'all'}
        busy={send.isPending}
        confirmLabel="Send"
      />
    </div>
  );
}

/** Search the customer table and pin the riders this send is for. */
function UserPicker({ picked, onChange }: { picked: CustomerRow[]; onChange: (p: CustomerRow[]) => void }) {
  const ds = useDS();
  const [q, setQ] = useState('');
  const { data, isFetching } = useQuery({
    queryKey: ['customer-search', q],
    queryFn: () => ds.listCustomers({ page: 1, pageSize: 8, search: q, sort: [], filters: {} }),
    enabled: q.trim().length >= 2,
  });
  const add = (c: CustomerRow) => { if (!picked.some((p) => p.id === c.id)) onChange([...picked, c]); setQ(''); };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <Field label="Find riders" hint="Phone, e-mail or name — at least 2 characters.">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="+3069… / name" />
      </Field>
      {q.trim().length >= 2 ? (
        <div className="stack" style={{ gap: 2, maxHeight: 180, overflowY: 'auto' }}>
          {isFetching ? <span className="muted" style={{ fontSize: 12 }}>Searching…</span> : null}
          {(data?.rows ?? []).map((c) => (
            <button key={c.id} className="nav-item" style={{ textAlign: 'left' }} onClick={() => add(c)}>
              {c.full_name ?? '—'} · <span className="mono" style={{ fontSize: 12 }}>{c.phone}</span>
            </button>
          ))}
          {!isFetching && (data?.rows.length ?? 0) === 0 ? <span className="muted" style={{ fontSize: 12 }}>No match.</span> : null}
        </div>
      ) : null}
      {picked.length ? (
        <div className="row-wrap" style={{ gap: 6 }}>
          {picked.map((p) => (
            <span key={p.id} className="chip active" onClick={() => onChange(picked.filter((x) => x.id !== p.id))} style={{ cursor: 'pointer' }}>
              {p.full_name ?? p.phone} ✕
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PhonePreview({ title, body }: { title: string; body: string }) {
  return (
    <div style={{
      margin: '0 auto', width: 240, borderRadius: 22, border: '8px solid var(--color-border)',
      background: 'var(--color-bg)', padding: 12, minHeight: 190, display: 'grid', placeItems: 'center',
    }}>
      <div style={{
        width: '100%', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)',
        boxShadow: '0 8px 24px rgba(0,0,0,.18)', padding: 14,
      }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{title || 'Title'}</div>
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', whiteSpace: 'pre-wrap' }}>
          {body || 'Your message shows up here.'}
        </div>
        <div style={{ textAlign: 'right', marginTop: 12 }}>
          <span style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)', padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>OK</span>
        </div>
      </div>
    </div>
  );
}

function History() {
  const ds = useDS();
  const state = useTableState({ sort: [{ field: 'created_at', dir: 'desc' }] });
  const { data, isLoading } = useQuery({ queryKey: ['broadcasts', state.params], queryFn: () => ds.listBroadcasts(state.params) });

  const columns: Column<BroadcastRow>[] = [
    { key: 'created_at', header: 'Sent', sortable: true, render: (b) => <span title={formatDateTime(b.created_at)}>{relativeTime(b.sent_at ?? b.created_at)}</span>, csv: (b) => b.created_at },
    { key: 'title', header: 'Title', render: (b) => b.title || <span className="muted">(no title)</span> },
    { key: 'audience_label', header: 'Audience', render: (b) => b.audience_label },
    { key: 'channels', header: 'Channels', render: (b) => <span style={{ display: 'flex', gap: 4 }}>{b.channels.map((c) => <Badge key={c} tone="neutral">{c}</Badge>)}</span>, csv: (b) => b.channels.join('+') },
    { key: 'category', header: 'Category', render: (b) => <Badge tone={b.category === 'marketing' ? 'info' : 'neutral'}>{b.category}</Badge> },
    { key: 'recipients', header: 'Recipients', align: 'right', sortable: true, render: (b) => b.recipients },
    { key: 'push_sent', header: 'Push', align: 'right', render: (b) => (b.channels.includes('push') ? `${b.push_sent}${b.push_failed ? ` / ${b.push_failed} failed` : ''}` : '—'), csv: (b) => b.push_sent },
    { key: 'status', header: 'Status', render: (b) => <Badge tone={b.status === 'sent' ? 'success' : b.status === 'failed' ? 'danger' : 'info'}>{titleCase(b.status)}</Badge> },
    { key: 'created_by_name', header: 'By', render: (b) => b.created_by_name },
    { key: 'reason', header: 'Reason', defaultHidden: true, render: (b) => b.reason ?? '—' },
  ];

  return (
    <Card>
      <CardHeader title="History" sub="Every send, who fired it and how far it reached" />
      <DataTable
        columns={columns}
        data={data}
        state={state}
        loading={isLoading}
        rowKey={(b) => b.id}
        searchPlaceholder="Search title, body, audience…"
        csvName="broadcasts"
      />
    </Card>
  );
}
