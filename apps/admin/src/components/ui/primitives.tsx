import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

/* ---------- Button ---------- */
type Variant = 'default' | 'primary' | 'danger' | 'ghost';
export function Button({
  variant = 'default',
  size,
  children,
  className = '',
  ...rest
}: { variant?: Variant; size?: 'sm' } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const v = variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : variant === 'ghost' ? 'btn-ghost' : '';
  return (
    <button className={`btn ${v} ${size === 'sm' ? 'btn-sm' : ''} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}

/* ---------- Card ---------- */
export function Card({ children, className = '', pad = false, style }: { children: ReactNode; className?: string; pad?: boolean; style?: React.CSSProperties }) {
  return <div className={`card ${pad ? 'card-pad' : ''} ${className}`.trim()} style={style}>{children}</div>;
}
export function CardHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="card-header">
      <div>
        <h3>{title}</h3>
        {sub ? <div className="card-title-sub">{sub}</div> : null}
      </div>
      {actions ? <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>{actions}</div> : null}
    </div>
  );
}

/* ---------- Fields ---------- */
export function Field({ label, required, children, hint }: { label?: string; required?: boolean; children: ReactNode; hint?: string }) {
  return (
    <div className="field">
      {label ? <label className={`field-label ${required ? 'req' : ''}`}>{label}</label> : null}
      {children}
      {hint ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{hint}</div> : null}
    </div>
  );
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${props.className ?? ''}`.trim()} {...props} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`textarea ${props.className ?? ''}`.trim()} {...props} />;
}
export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`select ${props.className ?? ''}`.trim()} {...props}>{children}</select>;
}
export function Checkbox({ label, ...props }: { label: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="checkbox-row">
      <input type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}

/* ---------- Misc ---------- */
export function Chip({ active, children, onClick }: { active?: boolean; children: ReactNode; onClick?: () => void }) {
  return <button type="button" className={`chip ${active ? 'active' : ''}`} onClick={onClick}>{children}</button>;
}
export function Divider() {
  return <div className="divider" />;
}
export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span style={{ display: 'inline-block', width: size, height: size, border: '2px solid var(--color-border)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }}>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </span>
  );
}
export function KV({ items }: { items: Array<[ReactNode, ReactNode]> }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
