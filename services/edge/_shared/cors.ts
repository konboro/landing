// Shared CORS headers + preflight helper for all edge functions.
//
// `x-penny-client` is not optional here: @penny/api-client sets it on every
// request (packages/api-client/src/client.ts), so leaving it out of the
// allow-list makes the browser reject the preflight with
// "HeaderDisallowedByPreflightResponse" and *every* edge call from the admin
// panel and the apps fails as a network error — the panel could sign in and
// then died on admin-me. curl never sees this; only browsers preflight.
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, x-penny-client, apikey, content-type, stripe-signature, x-payload-digest',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Returns a Response for an OPTIONS preflight, or null to continue. */
export function handlePreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}
