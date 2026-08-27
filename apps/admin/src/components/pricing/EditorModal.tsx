// Shared chrome for the five catalogue forms: the modal, the two kinds of
// message an operator can get back, and the confirm that removes a row.
//
// The two message kinds are deliberately different components. Validation is
// ours and lists every field at once so the operator fixes them in one pass; the
// server error is a single sentence somebody wrote for a human and is rendered
// verbatim, never re-worded, never replaced with "Something went wrong".

import type { ReactNode } from 'react';
import { Modal, ConfirmModal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/primitives';

export function Notice({ tone, title, children }: { tone: 'danger' | 'muted'; title?: ReactNode; children: ReactNode }) {
  const accent = tone === 'danger' ? 'var(--color-danger)' : 'var(--color-text-muted)';
  return (
    <div
      className="banner"
      style={{ borderColor: accent, background: 'var(--color-surface-alt)', marginBottom: 'var(--space-md)' }}
    >
      <div className="banner-bar" style={{ background: accent }} />
      <div style={{ fontSize: 'var(--fs-sm)' }}>
        {title ? <div style={{ fontWeight: 600, color: accent, marginBottom: 4 }}>{title}</div> : null}
        {children}
      </div>
    </div>
  );
}

export function EditorModal({
  open,
  onClose,
  title,
  sub,
  issues,
  serverError,
  busy,
  onSubmit,
  submitLabel = 'Save',
  size,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  sub?: ReactNode;
  /** Client-side problems. Non-empty disables the submit button. */
  issues: string[];
  /** The edge function's own sentence, shown untouched. */
  serverError: string | null;
  busy: boolean;
  onSubmit: () => void;
  submitLabel?: string;
  size?: 'lg';
  children: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size={size}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={busy || issues.length > 0}>
            {busy ? 'Saving…' : submitLabel}
          </Button>
        </>
      }
    >
      {sub ? <p className="muted" style={{ marginTop: 0 }}>{sub}</p> : null}
      {serverError ? <Notice tone="danger" title="The server refused this">{serverError}</Notice> : null}
      {issues.length > 0 ? (
        <Notice tone="muted" title={issues.length === 1 ? 'One thing to fix' : `${issues.length} things to fix`}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {issues.map((i) => <li key={i}>{i}</li>)}
          </ul>
        </Notice>
      ) : null}
      {children}
    </Modal>
  );
}

/**
 * Removal confirm. `hardDelete` decides the whole wording, because "delete" and
 * "deactivate" are genuinely different outcomes: a deactivated package is still
 * on every receipt that ever sold it, and an operator who reads "delete" will
 * assume it is gone.
 */
export function RemoveConfirm({
  open,
  onClose,
  onConfirm,
  noun,
  label,
  hardDelete,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  noun: string;
  /** What the operator clicked on — the plan's city, the package's name. */
  label: string;
  hardDelete: boolean;
  busy: boolean;
}) {
  return (
    <ConfirmModal
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      danger
      requireReason
      busy={busy}
      title={hardDelete ? `Delete ${noun}` : `Deactivate ${noun}`}
      confirmLabel={hardDelete ? 'Delete' : 'Deactivate'}
      message={
        hardDelete
          ? <>“{label}” will be <strong>permanently deleted</strong>. Rides already priced by it keep the price they were charged, but the plan itself is gone.</>
          : <>“{label}” will be <strong>deactivated, not deleted</strong>. It stops being offered to riders, and stays readable so existing receipts, disputes and history still resolve it.</>
      }
    />
  );
}

/** Row-level remove control. Stops the click reaching the row's edit handler. */
export function RemoveCell({ onRemove, hardDelete }: { onRemove: () => void; hardDelete: boolean }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      title={hardDelete ? 'Delete' : 'Deactivate — the row stays readable for history'}
      onClick={(e) => { e.stopPropagation(); onRemove(); }}
    >
      {hardDelete ? 'Delete' : 'Deactivate'}
    </Button>
  );
}
