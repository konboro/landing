// Turn-by-turn hand-off. Deep links into the platform maps app for navigation
// to a task/vehicle location (docs/07 feature 2 "navigate").
import { Linking, Platform } from 'react-native';
import type { LngLat } from '@penny/db-types';

export async function navigateTo(pos: LngLat, label?: string): Promise<void> {
  const [lng, lat] = pos;
  const name = label ? encodeURIComponent(label) : '';
  const url =
    Platform.OS === 'ios'
      ? `maps://?daddr=${lat},${lng}${name ? `&q=${name}` : ''}`
      : `google.navigation:q=${lat},${lng}`;
  const web = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  try {
    const ok = await Linking.canOpenURL(url);
    await Linking.openURL(ok ? url : web);
  } catch {
    try {
      await Linking.openURL(web);
    } catch {
      /* offline / no maps app — silently ignore */
    }
  }
}
