// Theme-aware StyleSheet factory.
//
// Screens used to do:
//     const styles = StyleSheet.create({ card: { backgroundColor: theme.color.surface } });
// which freezes the *static* default brand into the module. The themed form is:
//     const useStyles = makeStyles((t) => ({ card: { backgroundColor: t.color.surface } }));
//     …
//     const theme = useTheme();
//     const styles = useStyles(theme);
//
// Results are memoised per theme object (the provider keeps one stable object
// per brand+mode), so a re-render costs a WeakMap lookup and switching brand
// builds each sheet exactly once.
import { StyleSheet } from 'react-native';
import type { RiderTheme } from './deriveTheme';

type NamedStyles<T> = StyleSheet.NamedStyles<T>;

export function makeStyles<T extends NamedStyles<T> | NamedStyles<unknown>>(
  build: (theme: RiderTheme) => T,
): (theme: RiderTheme) => T {
  const cache = new WeakMap<RiderTheme, T>();
  return (theme: RiderTheme): T => {
    const hit = cache.get(theme);
    if (hit) return hit;
    const created = StyleSheet.create(build(theme));
    cache.set(theme, created);
    return created;
  };
}
