import { strict as assert } from 'node:assert';
import test from 'node:test';
import { legacyKey, parseLegacyLine, parseLegacyLog } from './legacy.ts';

test('parses the modern line format', () => {
  const r = parseLegacyLine(
    'Success! Transaction ID: txn_3U4G4eJOdefzvp0w0vB5PbQy, Charge ID: ch_3U4G4eJOdefzvp0w059ShAJP, ' +
      'AA number: 23108, MARK: 400014854516791, Date: 2026-08-14',
    1,
  );
  assert.deepEqual(r, {
    lineNumber: 1,
    ok: true,
    transactionId: 'txn_3U4G4eJOdefzvp0w0vB5PbQy',
    chargeId: 'ch_3U4G4eJOdefzvp0w059ShAJP',
    aa: 23108,
    mark: '400014854516791',
    error: null,
    date: '2026-08-14',
  });
});

test('parses the pre-2025-01-09 format that has no Charge ID', () => {
  const r = parseLegacyLine(
    'Success! Transaction ID: txn_3QRBVCJOdefzvp0w1DykG7oP, AA number: 100, ' +
      'MARK: 400007795019864, Date: 2024-12-01',
  );
  assert.equal(r?.chargeId, null);
  assert.equal(r?.aa, 100);
  assert.equal(r?.mark, '400007795019864');
});

test('parses a FAIL line, putting the error text where the MARK was', () => {
  const r = parseLegacyLine(
    'FAIL! Transaction ID: txn_x, AA number: 104, MARK: Unkown Error, Date: 2024-12-01',
  );
  assert.equal(r?.ok, false);
  assert.equal(r?.mark, null);
  assert.equal(r?.error, 'Unkown Error');
});

test('treats the literal "None" transaction id as absent', () => {
  const r = parseLegacyLine('FAIL! Transaction ID: None, AA number: 334, MARK: Unkown Error, Date: 2024-12-11');
  assert.equal(r?.transactionId, null);
});

test('tolerates the trailing space the logger wrote', () => {
  const r = parseLegacyLine('Success! Transaction ID: txn_a, AA number: 7, MARK: 4001, Date: 2025-05-05 ');
  assert.equal(r?.date, '2025-05-05');
  assert.equal(r?.mark, '4001');
});

test('correlation keys never collide for unidentifiable rows', () => {
  // Grouping these under a shared "None" key inflated a duplicate count from
  // 32 to 86 during analysis — they are distinct payments, not one payment
  // filed 55 times.
  const a = parseLegacyLine('FAIL! Transaction ID: None, AA number: 334, MARK: e, Date: 2024-12-11')!;
  const b = parseLegacyLine('FAIL! Transaction ID: None, AA number: 462, MARK: e, Date: 2024-12-16')!;
  assert.notEqual(legacyKey(a), legacyKey(b));
});

test('prefers charge id over transaction id as the key', () => {
  const r = parseLegacyLine('Success! Transaction ID: txn_a, Charge ID: ch_b, AA number: 9, MARK: 1, Date: 2025-01-01')!;
  assert.equal(legacyKey(r), 'ch_b');
});

test('parseLegacyLog skips blanks and reports what it could not read', () => {
  const { rows, unparsed } = parseLegacyLog(
    [
      'Success! Transaction ID: txn_a, AA number: 1, MARK: 400, Date: 2025-01-01',
      '',
      'this is not a log line',
      'FAIL! Transaction ID: txn_b, AA number: 2, MARK: boom, Date: 2025-01-02',
    ].join('\n'),
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(unparsed, ['this is not a log line']);
});
