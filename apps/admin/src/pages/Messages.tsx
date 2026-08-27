// Message centre — the staff side of the rider live chat.
//
// Two panes: the queue on the left (one row per rider, oldest-waiting first)
// and the transcript on the right. Threads that are waiting on us are sorted
// and badged, because the only number that matters here is "how many riders
// have not been answered".
//
// Replies go through the `admin-messages` edge function, never a direct write:
// a staff turn is service_role-only so it cannot be forged from the rider app.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDS } from '@/context/DataContext';
import type { ChatMessage, MessageThread } from '@/data/api';
import { useAuth } from '@/context/AuthContext';
import { Card, Button } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/format';

export function MessagesPage() {
  const ds = useDS();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const transcriptEnd = useRef<HTMLDivElement>(null);

  const threads = useQuery({
    queryKey: ['message-threads'],
    queryFn: () => ds.listMessageThreads(),
    // A support queue is only useful if it moves on its own.
    refetchInterval: 15_000,
  });

  const thread = useQuery({
    queryKey: ['message-thread', selected],
    queryFn: () => ds.getMessageThread(selected!),
    enabled: !!selected,
    refetchInterval: selected ? 10_000 : false,
  });

  const reply = useMutation({
    mutationFn: (body: string) => ds.replyToMessage(selected!, body),
    onSuccess: () => {
      setDraft('');
      void qc.invalidateQueries({ queryKey: ['message-thread', selected] });
      void qc.invalidateQueries({ queryKey: ['message-threads'] });
    },
  });

  // Waiting threads first, then most recent. Sorting here rather than on the
  // server keeps the queue responsive while a reply is in flight.
  const queue = useMemo(() => {
    const rows = threads.data ?? [];
    return [...rows].sort((a, b) => {
      if ((b.unanswered > 0 ? 1 : 0) !== (a.unanswered > 0 ? 1 : 0)) {
        return (b.unanswered > 0 ? 1 : 0) - (a.unanswered > 0 ? 1 : 0);
      }
      return a.last_at < b.last_at ? 1 : -1;
    });
  }, [threads.data]);

  useEffect(() => {
    if (!selected && queue.length) setSelected(queue[0]!.user_id);
  }, [queue, selected]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread.data]);

  const canReply = can('messages.reply');
  const waiting = queue.filter((t) => t.unanswered > 0).length;

  return (
    <div className="stack" style={{ gap: 'var(--space-lg)' }}>
      <div>
        <h1 style={{ margin: 0 }}>Message centre</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          {waiting > 0
            ? `${waiting} conversation${waiting === 1 ? '' : 's'} waiting for a reply`
            : 'Everything answered'}
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(260px, 340px) 1fr',
          gap: 'var(--space-lg)',
          alignItems: 'start',
        }}
      >
        {/* queue */}
        <Card>
          <div className="stack" style={{ gap: 0 }}>
            {threads.isLoading ? <div className="card-pad muted">Loading…</div> : null}
            {!threads.isLoading && queue.length === 0 ? (
              <div className="card-pad muted">No conversations yet.</div>
            ) : null}
            {queue.map((t) => (
              <QueueRow
                key={t.user_id}
                thread={t}
                active={t.user_id === selected}
                onClick={() => setSelected(t.user_id)}
              />
            ))}
          </div>
        </Card>

        {/* transcript */}
        <Card>
          <div className="card-pad stack" style={{ gap: 'var(--space-md)' }}>
            {!selected ? (
              <div className="muted">Pick a conversation.</div>
            ) : (
              <>
                <div
                  style={{
                    maxHeight: '52vh',
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {(thread.data ?? []).map((m: ChatMessage) => (
                    <Bubble key={m.id} message={m} />
                  ))}
                  <div ref={transcriptEnd} />
                </div>

                {canReply ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <textarea
                      className="input"
                      rows={2}
                      value={draft}
                      placeholder="Write a reply…"
                      onChange={(e) => setDraft(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        // Enter sends, Shift+Enter breaks the line — the shape
                        // every support tool uses.
                        if (e.key === 'Enter' && !e.shiftKey && draft.trim()) {
                          e.preventDefault();
                          reply.mutate(draft.trim());
                        }
                      }}
                      style={{ flex: 1, resize: 'vertical' }}
                    />
                    <Button
                      onClick={() => draft.trim() && reply.mutate(draft.trim())}
                      disabled={!draft.trim() || reply.isPending}
                    >
                      {reply.isPending ? 'Sending…' : 'Send'}
                    </Button>
                  </div>
                ) : (
                  <p className="muted" style={{ margin: 0 }}>
                    You can read this conversation but not reply.
                  </p>
                )}

                {reply.isError ? (
                  <p style={{ color: 'var(--color-danger)', margin: 0 }}>
                    {(reply.error as Error).message}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function QueueRow({
  thread,
  active,
  onClick,
}: {
  thread: MessageThread;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: 'var(--space-md)',
        border: 'none',
        borderBottom: '1px solid var(--color-border)',
        background: active ? 'var(--color-primary-soft)' : 'transparent',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ fontSize: 14 }}>
          {thread.full_name ?? thread.phone ?? 'Rider'}
        </strong>
        <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          {relativeTime(thread.last_at)}
        </span>
      </div>
      <div
        className="muted"
        style={{
          fontSize: 13,
          marginTop: 2,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {thread.last_sender === 'staff' ? 'You: ' : ''}
        {thread.last_body}
      </div>
      {thread.unanswered > 0 ? (
        <span
          style={{
            display: 'inline-block',
            marginTop: 6,
            padding: '1px 8px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            background: 'var(--color-primary)',
            color: 'var(--color-on-primary)',
          }}
        >
          {thread.unanswered} waiting
        </span>
      ) : null}
    </button>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const mine = message.sender !== 'rider';
  return (
    <div
      style={{
        alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: '76%',
        background: mine ? 'var(--color-primary)' : 'var(--color-surface-alt)',
        color: mine ? 'var(--color-on-primary)' : 'var(--color-text)',
        borderRadius: 14,
        borderBottomRightRadius: mine ? 4 : 14,
        borderBottomLeftRadius: mine ? 14 : 4,
        padding: '8px 12px',
      }}
    >
      <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{message.body}</div>
      <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
        {message.sender === 'system' ? 'Automated · ' : ''}
        {relativeTime(message.created_at)}
      </div>
    </div>
  );
}
