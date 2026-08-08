// Shared CORS headers + preflight helper for all edge functions.
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, stripe-signature, x-payload-digest',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Returns a Response for an OPTIONS preflight, or null to continue. */
export function handlePreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}
