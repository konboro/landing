import { strict as assert } from 'node:assert';
import test from 'node:test';
import { checkReceipt } from './guards.ts';
import { splitGross } from './money.ts';
import type { GuardContext } from './guards.ts';
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

const CTX: GuardContext = {
  maxGrossCents: 20_000,
  floorAa: 23_109,
  now: new Date('2026-08-20T12:00:00Z'),
};

function receipt(over: Partial<ReceiptInput> = {}): ReceiptInput {
  const gross = over.grossCents ?? 3000;
  const { netCents, vatCents } = splitGross(gross, TAX.vat_rate);
  return {
    series: 'ΑΠΥ',
    aa: 23_200,
    issueDate: '2026-08-19',
    grossCents: gross,
    netCents,
    vatCents,
    currency: 'EUR',
    tax: TAX,
    ...over,
  };
}

test('a normal receipt passes', () => {
  assert.deepEqual(checkReceipt(receipt(), CTX), { ok: true, violations: [] });
});

test('stops an implausibly large receipt', () => {
  const r = checkReceipt(receipt({ grossCents: 4_000_000 }), CTX);
  assert.equal(r.ok, false);
  assert.match(r.violations.join(' '), /exceeds the ceiling/);
});

test('stops a number that belongs to the legacy system', () => {
  const r = checkReceipt(receipt({ aa: 22_000 }), CTX);
  assert.equal(r.ok, false);
  assert.match(r.violations.join(' '), /below the series floor/);
});

test('stops a future-dated receipt', () => {
  const r = checkReceipt(receipt({ issueDate: '2026-09-30' }), CTX);
  assert.equal(r.ok, false);
  assert.match(r.violations.join(' '), /in the future/);
});

test('stops a receipt past the transmission window', () => {
  const r = checkReceipt(receipt({ issueDate: '2026-01-01' }), CTX);
  assert.equal(r.ok, false);
  assert.match(r.violations.join(' '), /days old/);
});

test('tolerates same-day and yesterday', () => {
  assert.equal(checkReceipt(receipt({ issueDate: '2026-08-20' }), CTX).ok, true);
  assert.equal(checkReceipt(receipt({ issueDate: '2026-08-19' }), CTX).ok, true);
});

test('stops a non-EUR receipt', () => {
  assert.equal(checkReceipt(receipt({ currency: 'USD' }), CTX).ok, false);
});

test('stops a broken summary even though the builder would too', () => {
  const r = checkReceipt(
    { ...receipt(), netCents: 2400, vatCents: 581, grossCents: 3000 },
    CTX,
  );
  assert.equal(r.ok, false);
  assert.match(r.violations.join(' '), /reconcile/);
});

test('stops a malformed issuer VAT', () => {
  const r = checkReceipt(receipt({ tax: { ...TAX, issuer_vat: 'EL802160515' } }), CTX);
  assert.equal(r.ok, false);
  assert.match(r.violations.join(' '), /9 digits/);
});

test('collects every violation rather than the first', () => {
  const r = checkReceipt(
    receipt({ grossCents: 900_000, aa: 1, currency: 'GBP', issueDate: '2030-01-01' }),
    CTX,
  );
  assert.ok(r.violations.length >= 4, `expected several, got ${r.violations.length}`);
});
