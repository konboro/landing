// Runtime theming for the whole panel.
//
// Every colour, radius, spacing and font size the panel renders comes from a
// CSS custom property on <html>. Those properties are now fed by the active
// *brand* (@penny/ui `brand.ts`) instead of the hardcoded token ramp, so
// switching brand or theme mode re-themes the panel live with no rebuild and
// without touching a single component.
//
// The variable *names* are unchanged (`--color-*`, `--space-*`, `--radius-*`,
// `--fs-*`, `--font-*`, `--shadow-*`, `--pal-*`) — components keep working
// exactly as written.
import { palette, space, radius, font, shadow } from '@penny/ui';
import {
  brandCssVars,
  pennyBrand,
  resolveColors,
  scaledFontSize,
  scaledRadius,
  scaledSpace,
  statusColor,
  type Brand,
  type ThemeMode,
} from '@penny/ui';

/** Vehicle statuses that get their own `--status-*` variable. */
export const STATUS_KEYS = [
  'available', 'reserved', 'in_trip', 'low_battery',
  'maintenance', 'transport', 'offline', 'stolen', 'decommissioned',
] as const;

function setAll(root: HTMLElement, vars: Record<string, string>): void {
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

/**
 * Everything the panel's CSS reads, derived from a brand + theme mode.
 * Exported (rather than applied straight to the DOM) so the Branding editor's
 * live preview can scope the very same variables to a preview container.
 */
export function themeVars(brand: Brand, mode: ThemeMode = 'light'): Record<string, string> {
  const c = resolveColors(brand, mode);
  const dark = mode === 'dark';
  const vars: Record<string, string> = {
    // --brand-* (raw brand surface, also consumed by the Branding preview)
    ...brandCssVars(brand, mode),

    // --pal-* : the neutral ramp stays available for legacy call sites.
    ...Object.fromEntries(Object.entries(palette).map(([k, v]) => [`--pal-${k}`, v])),

    // --color-* : semantic colours, now brand-fed.
    '--color-primary': c.primary,
    '--color-primary-dark': c.primaryDark,
    '--color-primary-soft': c.primarySoft,
    '--color-on-primary': c.onPrimary,
    '--color-bg': c.bg,
    '--color-surface': c.surface,
    '--color-surface-alt': c.surfaceAlt,
    '--color-border': c.border,
    '--color-text': c.text,
    '--color-text-muted': c.textMuted,
    '--color-text-inverse': c.textInverse,
    '--color-success': c.success,
    '--color-warning': c.warning,
    '--color-danger': c.danger,

    // Typography / shape, scaled by the brand's multipliers.
    '--font-sans': brand.typography.sans,
    '--font-mono': brand.typography.mono,
    '--shadow-card': shadow.card,
    '--shadow-pop': shadow.pop,

    // Chrome surfaces that used to be hardcoded to the ink ramp. Derived from
    // the brand so a re-themed panel gets a matching sidebar/toast/hex viewer.
    '--chrome-bg': dark ? c.surfaceAlt : c.primaryDark,
    '--chrome-text': c.textInverse,
    '--chrome-text-muted': dark ? c.textMuted : withAlpha(c.textInverse, 0.62),
    '--chrome-text-dim': dark ? c.textMuted : withAlpha(c.textInverse, 0.45),
    '--chrome-hover': withAlpha(c.textInverse, 0.09),
    '--overlay-bg': withAlpha(dark ? '#000000' : c.text, 0.45),
    '--overlay-bg-soft': withAlpha(dark ? '#000000' : c.text, 0.35),
    '--toast-bg': dark ? c.surfaceAlt : c.text,
    '--toast-text': dark ? c.text : c.textInverse,
    '--code-bg': dark ? c.bg : c.text,
    '--code-text': dark ? c.text : c.surfaceAlt,
    '--shade-1': c.surfaceAlt,
    '--shade-2': c.bg,
  };

  for (const [k, v] of Object.entries(space)) vars[`--space-${k}`] = `${scaledSpace(brand, v)}px`;
  for (const [k, v] of Object.entries(radius)) {
    vars[`--radius-${k}`] = k === 'pill' ? `${v}px` : `${scaledRadius(brand, v)}px`;
  }
  for (const [k, v] of Object.entries(font.size)) vars[`--fs-${k}`] = `${scaledFontSize(brand, v)}px`;
  for (const [k, v] of Object.entries(font.weight)) vars[`--fw-${k}`] = v;

  // Vehicle status colours — single source of truth is statusColor(brand, …).
  for (const s of STATUS_KEYS) vars[`--status-${s.replace(/_/g, '-')}`] = statusColor(brand, s, mode);

  return vars;
}

/** Apply a brand + mode to <html>. Called by BrandContext on every change. */
export function applyBrandTheme(brand: Brand, mode: ThemeMode = 'light'): void {
  const root = document.documentElement;
  setAll(root, themeVars(brand, mode));
  root.setAttribute('data-theme', mode);
  root.style.colorScheme = mode;
}

/**
 * Boot-time defaults so the very first paint (before BrandContext resolves the
 * server-side brand) is already themed rather than unstyled.
 */
export function injectThemeVars(): void {
  applyBrandTheme(pennyBrand, 'light');
}

/** `#rrggbb` → `rgba(r,g,b,a)`. Non-hex input is returned untouched. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return hex;
  const [r, g, b] = [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
  return `rgba(${r},${g},${b},${alpha})`;
}
