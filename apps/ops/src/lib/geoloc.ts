// Guarded location access. Returns Athens center as a safe fallback so routing
// and geotagging work even without permission / in Expo Go.
import type { LngLat } from '@penny/db-types';
import { ATHENS_CENTER } from '../services/mockData';

let Location: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Location = require('expo-location');
} catch {
  Location = null;
}

export async function getCurrentPos(): Promise<{ pos: LngLat; real: boolean }> {
  if (!Location) return { pos: ATHENS_CENTER, real: false };
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm?.granted) return { pos: ATHENS_CENTER, real: false };
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy?.Balanced ?? 3 });
    return { pos: [loc.coords.longitude, loc.coords.latitude], real: true };
  } catch {
    return { pos: ATHENS_CENTER, real: false };
  }
}
