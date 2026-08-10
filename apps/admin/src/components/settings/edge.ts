/**
 * Recover the sentence the edge function actually wrote.
 *
 * supabase-js flattens every non-2xx into a `FunctionsHttpError` whose
 * `.message` is always the literal "Edge Function returned a non-2xx status
 * code". The reason an operator needs — "forbidden: settings.edit",
 * "key.lang is required for app_content", "app_config key not writable from
 * the panel: foo" — is in the response body hanging off `.context`.
 *
 * The data source unwraps this for calls that go through it, so by the time an
 * error reaches here it is often already a plain Error with the real message.
 * Both shapes are handled: whichever arrives, the operator sees the server's
 * own words rather than a generic failure.
 */
export async function edgeMessage(e: unknown, fallback: string): Promise<string> {
  const ctx = (e as { context?: unknown } | null)?.context;

  // supabase-js ≥2.39 hands back the raw Response.
  if (ctx instanceof Response) {
    try {
      const body = (await ctx.clone().json()) as { message?: string; error?: string } | null;
      const message = body?.message ?? body?.error;
      if (message) return message;
    } catch {
      // Not JSON (gateway timeout, crash before the handler): the status line
      // at least separates "refused" from "broke".
    }
    return `${fallback} (HTTP ${ctx.status})`;
  }

  // Older shape: an object exposing .json().
  const json = (ctx as { json?: () => Promise<unknown> } | undefined)?.json;
  if (typeof json === 'function') {
    try {
      const body = (await json.call(ctx)) as { message?: string; error?: string } | null;
      const message = body?.message ?? body?.error;
      if (message) return message;
    } catch {
      /* not JSON */
    }
  }

  const raw = e instanceof Error ? e.message : '';
  if (raw && !/non-2xx status code/i.test(raw)) return raw;
  return fallback;
}
