// Theme-aware StyleSheet factory (see the rider app's copy for the rationale).
//
//   const useStyles = makeStyles((t) => ({ card: { backgroundColor: t.c.surface } }));
//   …
//   const theme = useTheme();
//   const st = useStyles(theme);
//
// Memoised per theme object — the provider keeps one stable object per
// brand+mode, so re-renders cost a WeakMap lookup.
import { StyleSheet } from 'react-native';
import type { OpsTheme } from './deriveTheme';

type NamedStyles<T> = StyleSheet.NamedStyles<T>;

export function makeStyles<T extends NamedStyles<T> | NamedStyles<unknown>>(
  build: (theme: OpsTheme) => T,
): (theme: OpsTheme) => T {
  const cache = new WeakMap<OpsTheme, T>();
  return (theme: OpsTheme): T => {
    const hit = cache.get(theme);
    if (hit) return hit;
    const created = StyleSheet.create(build(theme));
    cache.set(theme, created);
    return created;
  };
}
