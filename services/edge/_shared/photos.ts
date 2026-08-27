// Ride-photo storage helpers (docs/04, zone workflows M1).
//
// The end-of-ride parking photo lives in the PRIVATE `ride-photos` bucket (migration
// 00570). Nothing about it is ever public: writers get a short-TTL signed UPLOAD url,
// readers (staff panel, ops app, the AI pre-screen) get a short-TTL signed DOWNLOAD
// url. Every path is server-minted with the service_role client, so the bucket needs
// no storage.objects RLS.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const RIDE_PHOTOS_BUCKET = 'ride-photos';

/** Canonical object path for a trip's single end photo: '<trip_id>/end.jpg'. */
export function endPhotoPath(tripId: string): string {
  return `${tripId}/end.jpg`;
}

/**
 * Turn a stored end_photo_url (an object PATH, see 00570) into a short-TTL signed
 * download URL, or null when there is no photo or signing fails. Callers render the
 * URL directly; a null degrades to a placeholder rather than throwing.
 */
export async function signRidePhoto(
  admin: SupabaseClient,
  path: string | null | undefined,
  ttlSeconds = 600,
): Promise<string | null> {
  if (!path) return null;
  // Tolerate a legacy value that already looks like a URL (pre-00570 rows / mocks).
  if (/^https?:\/\//i.test(path)) return path;
  const { data, error } = await admin.storage
    .from(RIDE_PHOTOS_BUCKET)
    .createSignedUrl(path, ttlSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
