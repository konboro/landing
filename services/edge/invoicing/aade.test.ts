import { strict as assert } from 'node:assert';
import test from 'node:test';
import { AadeAdapter } from './aade.ts';
import { splitGross } from './money.ts';
import type { ReceiptInput, TaxProfile } from './types.ts';

const TAX: TaxProfile = {
  vat_rate: 0.24,
  issuer_vat: '802160515',
  branch: 1,
  invoice_type: '11.2',
  vat_category: 1,
  payment_method_type: 6,
  classification_type: 'E3_561_003',
  classification_category: 'category1_3',
};

const CREDS = { userId: '802160515', subscriptionKey: 'test-key' };

function receipt(): ReceiptInput {
  const { netCents, vatCents } = splitGross(3000, 0.24);
  return {
    series: 'ΑΠΥ',
    aa: 23109,
    issueDate: '2026-08-15',
    grossCents: 3000,
    netCents,
    vatCents,
    currency: 'EUR',
    tax: TAX,
  };
}

const OK_BODY = '<ResponseDoc><response><statusCode>Success</statusCode>' +
  '<invoiceUid>UID1</invoiceUid><invoiceMark>400014854516792</invoiceMark>' +
  '<authenticationCode>AUTH1</authenticationCode></response></ResponseDoc>';

function stubFetch(status: number, body: string, capture?: { req?: Request }) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    if (capture) capture.req = new Request(String(input), init);
    return new Response(body, { status });
  };
}

test('dry_run renders the document but cannot transmit it', async () => {
  let called = false;
  const adapter = new AadeAdapter({
    mode: 'dry_run',
    credentials: CREDS,
    fetchImpl: async () => {
      called = true;
      return new Response(OK_BODY, { status: 200 });
    },
  });

  const out = await adapter.send(receipt());
  assert.equal(called, false, 'dry_run must not reach the network');
  assert.equal(out.ok, false);
  assert.equal(out.retryable, false, 'a dry run is terminal, not a pending retry');
  assert.match(out.raw, /<InvoicesDoc/, 'the rendered document is still returned for inspection');
});

test('a success returns the MARK and the identifiers', async () => {
  const cap: { req?: Request } = {};
  const adapter = new AadeAdapter({
    mode: 'live',
    credentials: CREDS,
    fetchImpl: stubFetch(200, OK_BODY, cap),
  });

  const out = await adapter.send(receipt());
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.mark, '400014854516792');
    assert.equal(out.uid, 'UID1');
    assert.equal(out.authCode, 'AUTH1');
  }
  assert.equal(cap.req?.headers.get('aade-user-id'), '802160515');
  assert.equal(cap.req?.headers.get('ocp-apim-subscription-key'), 'test-key');
  assert.equal(cap.req?.url, 'https://mydatapi.aade.gr/myDATA/SendInvoices');
});

test('sandbox posts to the development endpoint', async () => {
  const cap: { req?: Request } = {};
  const adapter = new AadeAdapter({
    mode: 'sandbox',
    credentials: CREDS,
    fetchImpl: stubFetch(200, OK_BODY, cap),
  });
  await adapter.send(receipt());
  assert.match(cap.req?.url ?? '', /mydataapidev\.aade\.gr/);
});

test('a validation rejection is permanent and carries the reason', async () => {
  const body = '<ResponseDoc><response><statusCode>ValidationError</statusCode><errors><error>' +
    '<message>aa already exists</message><code>223</code></error></errors></response></ResponseDoc>';
  const adapter = new AadeAdapter({ mode: 'live', credentials: CREDS, fetchImpl: stubFetch(400, body) });

  const out = await adapter.send(receipt());
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.equal(out.retryable, false);
    assert.match(out.error, /223/);
    assert.match(out.error, /aa already exists/);
    assert.equal(out.httpStatus, 400);
  }
});

test('a server fault is retryable', async () => {
  const adapter = new AadeAdapter({
    mode: 'live',
    credentials: CREDS,
    fetchImpl: stubFetch(503, '<html>Service Unavailable</html>'),
  });
  const out = await adapter.send(receipt());
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.retryable, true);
});

test('a transport failure is retryable and never throws', async () => {
  const adapter = new AadeAdapter({
    mode: 'live',
    credentials: CREDS,
    fetchImpl: async () => {
      throw new Error('ECONNRESET');
    },
  });
  const out = await adapter.send(receipt());
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.equal(out.retryable, true);
    assert.match(out.error, /ECONNRESET/);
  }
});

test('a timeout is reported as a timeout, not as a rejection', async () => {
  const adapter = new AadeAdapter({
    mode: 'live',
    credentials: CREDS,
    timeoutMs: 20,
    fetchImpl: (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      }),
  });
  const out = await adapter.send(receipt());
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.equal(out.retryable, true);
    assert.match(out.error, /timed out/);
  }
});

test('missing credentials never reach the network', async () => {
  let called = false;
  const adapter = new AadeAdapter({
    mode: 'live',
    credentials: { userId: '', subscriptionKey: '' },
    fetchImpl: async () => {
      called = true;
      return new Response(OK_BODY);
    },
  });
  const out = await adapter.send(receipt());
  assert.equal(called, false);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.retryable, true);
});
