// Injects CSS custom properties derived from the single source of truth
// (@penny/ui tokens) so global.css and components can reference var(--...).
import { palette, colors, space, radius, font, shadow } from '@penny/ui';

export function injectThemeVars(): void {
  const root = document.documentElement;
  const set = (k: string, v: string | number) => root.style.setProperty(k, String(v));

  // palette
  for (const [k, v] of Object.entries(palette)) set(`--pal-${k}`, v);

  // semantic colors
  set('--color-primary', colors.primary);
  set('--color-primary-dark', colors.primaryDark);
  set('--color-primary-soft', colors.primarySoft);
  set('--color-on-primary', colors.onPrimary);
  set('--color-bg', colors.bg);
  set('--color-surface', colors.surface);
  set('--color-surface-alt', colors.surfaceAlt);
  set('--color-border', colors.border);
  set('--color-text', colors.text);
  set('--color-text-muted', colors.textMuted);
  set('--color-success', colors.success);
  set('--color-warning', colors.warning);
  set('--color-danger', colors.danger);

  // spacing
  for (const [k, v] of Object.entries(space)) set(`--space-${k}`, `${v}px`);
  // radius
  for (const [k, v] of Object.entries(radius)) set(`--radius-${k}`, `${v}px`);
  // typography
  set('--font-sans', font.family.sans);
  set('--font-mono', font.family.mono);
  for (const [k, v] of Object.entries(font.size)) set(`--fs-${k}`, `${v}px`);
  for (const [k, v] of Object.entries(font.weight)) set(`--fw-${k}`, v);
  // shadow
  set('--shadow-card', shadow.card);
  set('--shadow-pop', shadow.pop);
}
