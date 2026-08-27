// AADE response reader.
//
// A successful SendInvoices response looks like:
//
//   <ResponseDoc><response>
//     <index>1</index><statusCode>Success</statusCode>
//     <invoiceUid>...</invoiceUid><invoiceMark>400014854516791</invoiceMark>
//     <authenticationCode>...</authenticationCode><qrUrl>...</qrUrl>
//   </response></ResponseDoc>
//
// A rejection carries the same envelope with a non-Success statusCode and an
// <errors><error><message>/<code> block.
//
// Deliberately regex-based rather than DOM-based: the shape is fixed and narrow,
// Node has no built-in DOMParser (these modules are unit tested under node), and
// a dependency here would have to be vendored into the Deno bundle.

export interface AadeResponse {
  ok: boolean;
  mark?: string;
  uid?: string;
  authCode?: string;
  statusCode?: string;
  errorCode?: string;
  errorMessage?: string;
}

/** Read the first `<tag>` (namespace prefix optional) out of an XML string. */
function tag(xml: string, name: string): string | undefined {
  const m = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${name}>`)
    .exec(xml);
  const inner = m?.[1];
  return inner === undefined ? undefined : decodeEntities(inner.trim());
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Interpret a SendInvoices response body.
 *
 * The legacy code treated "no <invoiceMark> found" as the only failure signal
 * and, on a non-200, searched the REQUEST document for errors instead of the
 * response — so every one of the 40 recorded failures logged "Unkown Error"
 * with no diagnosis. Here a missing mark is an explicit, described failure.
 */
export function parseAadeResponse(body: string): AadeResponse {
  const statusCode = tag(body, 'statusCode');
  const mark = tag(body, 'invoiceMark');

  if (mark && /^\d+$/.test(mark)) {
    return {
      ok: true,
      mark,
      uid: tag(body, 'invoiceUid'),
      authCode: tag(body, 'authenticationCode'),
      statusCode,
    };
  }

  // Errors may be nested under <errors><error>; take the first.
  const errorBlock = /<(?:[A-Za-z0-9_.-]+:)?errors\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?errors>/
    .exec(body);
  const scope = errorBlock?.[1] ?? body;

  return {
    ok: false,
    statusCode,
    errorCode: tag(scope, 'code'),
    errorMessage: tag(scope, 'message')
      ?? (statusCode ? `AADE returned statusCode=${statusCode} with no invoiceMark` : undefined)
      ?? 'no invoiceMark and no error message in response',
  };
}

/**
 * Should this failure be retried?
 *
 * Validation errors are permanent — the same document will be rejected forever,
 * so retrying burns attempts and delays the human who needs to look at it.
 * Transport and server-side faults are transient.
 */
export function isRetryable(httpStatus: number | undefined, r: AadeResponse): boolean {
  if (httpStatus === undefined) return true; // network failure, never reached AADE
  if (httpStatus === 429) return true;
  if (httpStatus >= 500) return true;
  if (httpStatus === 401 || httpStatus === 403) return true; // usually a key/quota blip, worth a retry
  if (httpStatus >= 400) return false; // 400 ValidationError and friends: permanent
  // HTTP 200 but no mark — AADE reports business rejections this way.
  const code = (r.statusCode ?? '').toLowerCase();
  return !code.includes('validation');
}
