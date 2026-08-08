import { useEffect, useState, type ReactNode } from 'react';
import { Button, Field, Textarea } from './primitives';

export function Modal({ open, onClose, title, children, footer, size }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'lg' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <div className={`modal ${size === 'lg' ? 'lg' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <Button variant="ghost" className="btn-icon" style={{ marginLeft: 'auto' }} onClick={onClose}>✕</Button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  if (!open) return null;
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <Button variant="ghost" className="btn-icon" style={{ marginLeft: 'auto' }} onClick={onClose}>✕</Button>
        </div>
        <div className="modal-body" style={{ flex: 1 }}>{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

/** Confirm dialog with optional mandatory reason field (money/destructive actions). */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  requireReason,
  reasonLabel = 'Reason',
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  title: ReactNode;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  busy?: boolean;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (!open) setReason(''); }, [open]);
  const disabled = busy || (requireReason ? reason.trim().length < 3 : false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} disabled={disabled} onClick={() => onConfirm(reason.trim())}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      {message ? <p style={{ marginTop: 0 }}>{message}</p> : null}
      {requireReason ? (
        <Field label={reasonLabel} required hint="Recorded in the audit log (who / what / reason).">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain why — mandatory for this action" />
        </Field>
      ) : null}
    </Modal>
  );
}
