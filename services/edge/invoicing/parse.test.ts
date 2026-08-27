import { strict as assert } from 'node:assert';
import test from 'node:test';
import { isRetryable, parseAadeResponse } from './parse.ts';

const SUCCESS = `<?xml version="1.0" encoding="utf-8"?>
<ResponseDoc xmlns="http://www.aade.gr/myDATA/response/v1.0">
  <response>
    <index>1</index>
    <invoiceUid>0A1B2C3D4E5F60718293A4B5C6D7E8F9</invoiceUid>
    <invoiceMark>400014854516791</invoiceMark>
    <authenticationCode>7A6B5C4D3E2F1009</authenticationCode>
    <qrUrl>https://www.aade.gr/qr/abc</qrUrl>
    <statusCode>Success</statusCode>
  </response>
</ResponseDoc>`;

const VALIDATION_ERROR = `<?xml version="1.0" encoding="utf-8"?>
<ResponseDoc xmlns="http://www.aade.gr/myDATA/response/v1.0">
  <response>
    <index>1</index>
    <statusCode>ValidationError</statusCode>
    <errors>
      <error>
        <message>Invalid field value: aa already exists for this series</message>
        <code>223</code>
      </error>
    </errors>
  </response>
</ResponseDoc>`;

test('reads a MARK out of a success response', () => {
  const r = parseAadeResponse(SUCCESS);
  assert.equal(r.ok, true);
  assert.equal(r.mark, '400014854516791');
  assert.equal(r.uid, '0A1B2C3D4E5F60718293A4B5C6D7E8F9');
  assert.equal(r.authCode, '7A6B5C4D3E2F1009');
  assert.equal(r.statusCode, 'Success');
});

test('reads the message and code out of a rejection', () => {
  const r = parseAadeResponse(VALIDATION_ERROR);
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, '223');
  assert.match(r.errorMessage ?? '', /aa already exists/);
});

test('a response with neither mark nor error still explains itself', () => {
  // The legacy code produced "Unkown Error" here — 40 times, with no diagnosis.
  const r = parseAadeResponse('<ResponseDoc><response><index>1</index></response></ResponseDoc>');
  assert.equal(r.ok, false);
  assert.ok(r.errorMessage && r.errorMessage.length > 0);
  assert.doesNotMatch(r.errorMessage, /^Unkown/);
});

test('a non-numeric mark is not a success', () => {
  const r = parseAadeResponse('<response><invoiceMark>N/A</invoiceMark></response>');
  assert.equal(r.ok, false);
});

test('handles namespace prefixes and entities', () => {
  const r = parseAadeResponse(
    '<ns:response xmlns:ns="x"><ns:statusCode>ValidationError</ns:statusCode>' +
      '<ns:errors><ns:error><ns:message>bad &amp; wrong</ns:message></ns:error></ns:errors></ns:response>',
  );
  assert.equal(r.ok, false);
  assert.equal(r.errorMessage, 'bad & wrong');
});

test('retry classification: transient faults retry, validation errors do not', () => {
  const err = parseAadeResponse(VALIDATION_ERROR);
  assert.equal(isRetryable(undefined, err), true, 'network failure must retry');
  assert.equal(isRetryable(500, err), true);
  assert.equal(isRetryable(503, err), true);
  assert.equal(isRetryable(429, err), true);
  assert.equal(isRetryable(401, err), true);
  assert.equal(isRetryable(400, err), false, 'a rejected document stays rejected');
  assert.equal(isRetryable(200, err), false, 'HTTP 200 ValidationError is permanent');
  assert.equal(isRetryable(200, parseAadeResponse('<response><statusCode>Busy</statusCode></response>')), true);
});
