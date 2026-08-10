// Shared pieces for the catalogue editors on Marketing / Content / Team.

import { useEffect, useState, type ReactNode } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button, Input } from '@/components/ui/primitives';
import { useBrand } from '@/context/BrandContext';

/** Add/edit dialog. The caller owns the form state; this owns the chrome. */
export function EntityModal({
  open, onClose, title, children, onSave, saveLabel = 'Save', canSave = true, busy, extraFooter,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  onSave: () => void;
  saveLabel?: string;
  canSave?: boolean;
  busy?: boolean;
  extraFooter?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          {extraFooter}
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" disabled={!canSave || busy} onClick={onSave}>
            {busy ? 'Saving…' : saveLabel}
          </Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 'var(--space-md)' }}>{children}</div>
    </Modal>
  );
}

/**
 * Removal confirm. `mode` decides the wording, and it must match what the
 * server will really do: catalogues referenced by history are deactivated, and
 * calling that "delete" in the dialog would be a lie the operator only
 * discovers afterwards.
 */
export function RemoveConfirm({
  open, onClose, onConfirm, mode, label, name, busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  mode: 'delete' | 'deactivate';
  /** Singular noun, e.g. "FAQ entry". */
  label: string;
  /** Human identifier of the row being removed. */
  name: string;
  busy?: boolean;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (!open) setReason(''); }, [open]);
  const deactivating = mode === 'deactivate';
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={deactivating ? `Deactivate ${label}` : `Delete ${label}`}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" disabled={busy} onClick={() => onConfirm(reason.trim())}>
            {busy ? 'Working…' : deactivating ? 'Deactivate' : 'Delete'}
          </Button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        {deactivating ? (
          <>
            <strong>{name}</strong> stays in the database and keeps resolving on past
            receipts and history — it is switched off, not deleted.
          </>
        ) : (
          <><strong>{name}</strong> will be deleted permanently.</>
        )}
      </p>
      <label className="field-label">Reason (recorded in the audit log)</label>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" />
    </Modal>
  );
}

/**
 * States plainly that a control is missing because the backend cannot support
 * it yet. Used instead of shipping a button that would fail, or — worse — one
 * that reports success without writing anything.
 */
export function UnavailableNote({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useBrand();
  return (
    <div className="banner" style={{ borderColor: `${colors.warning}55`, background: `${colors.warning}12` }}>
      <div className="banner-bar" style={{ background: colors.warning }} />
      <div>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{children}</div>
      </div>
    </div>
  );
}

/** Edit / remove buttons for a catalogue row. */
export function RowActions({
  onEdit, onRemove, removeLabel = 'Delete', disabled, removeDisabledReason,
}: {
  onEdit: () => void;
  onRemove?: () => void;
  removeLabel?: string;
  disabled?: boolean;
  /** When set, the remove button is disabled and explains itself on hover. */
  removeDisabledReason?: string;
}) {
  return (
    <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
      <Button size="sm" onClick={onEdit} disabled={disabled}>Edit</Button>
      {onRemove ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={onRemove}
          disabled={disabled || !!removeDisabledReason}
          title={removeDisabledReason}
        >
          {removeLabel}
        </Button>
      ) : null}
    </div>
  );
}

/** Editor for a Postgres `text[]` column, one line per entry. */
export function StringListEditor({
  value, onChange, placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      {value.map((item, i) => (
        <div key={i} className="row" style={{ gap: 6 }}>
          <Input
            value={item}
            placeholder={placeholder}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <Button variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</Button>
        </div>
      ))}
      <div><Button size="sm" onClick={() => onChange([...value, ''])}>+ Add</Button></div>
    </div>
  );
}
