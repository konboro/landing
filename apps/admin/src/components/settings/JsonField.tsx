import { useState } from 'react';
import { Field, Textarea } from '@/components/ui/primitives';
import { useBrand } from '@/context/BrandContext';

/**
 * A jsonb column edited as JSON, with the parse error shown instead of hidden.
 *
 * `notification_rules.condition` and `app_content.value` are genuinely
 * free-form per event kind / content key — there is no fixed set of fields to
 * render. A textarea that reports exactly where the JSON breaks is honest;
 * silently swallowing a syntax error and saving the last valid value is not.
 *
 * Mount this fresh (or give it a `key`) when the underlying row changes — it
 * owns the text buffer so the operator's half-typed JSON survives re-renders.
 */
export function JsonField({
  label,
  hint,
  value,
  onChange,
  onValidityChange,
  rows = 6,
  disabled,
}: {
  label: string;
  hint?: string;
  value: unknown;
  onChange: (parsed: unknown) => void;
  onValidityChange?: (valid: boolean) => void;
  rows?: number;
  disabled?: boolean;
}) {
  const { colors } = useBrand();
  const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
  const [error, setError] = useState<string | null>(null);

  const handle = (next: string) => {
    setText(next);
    if (next.trim() === '') {
      setError(null);
      onValidityChange?.(true);
      onChange(null);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(next);
      setError(null);
      onValidityChange?.(true);
      onChange(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON');
      onValidityChange?.(false);
    }
  };

  return (
    <Field label={label} hint={hint}>
      <Textarea
        className="mono"
        style={{ fontSize: 12, ...(error ? { borderColor: colors.danger } : {}) }}
        rows={rows}
        value={text}
        disabled={disabled}
        onChange={(e) => handle(e.target.value)}
      />
      {error ? (
        <div style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>Invalid JSON — {error}</div>
      ) : null}
    </Field>
  );
}
