import { strict as assert } from 'node:assert';
import test from 'node:test';
import { formatAmount, splitGross } from './money.ts';

test('splitGross always reconciles', () => {
  for (let gross = 1; gross <= 50_000; gross++) {
    const { netCents, vatCents } = splitGross(gross, 0.24);
    assert.equal(netCents + vatCents, gross, `failed to reconcile at ${gross}`);
    assert.ok(netCents >= 0 && vatCents >= 0);
  }
});

test('splitGross matches the values the legacy pipeline actually filed', () => {
  // From edited_invoice.xml and the invoice_template.xml default, i.e. documents
  // AADE accepted.
  assert.deepEqual(splitGross(3000, 0.24), { netCents: 2419, vatCents: 581, grossCents: 3000 });
  assert.deepEqual(splitGross(100, 0.24), { netCents: 81, vatCents: 19, grossCents: 100 });
});

test('splitGross agrees with the legacy Python algorithm across the charge range', () => {
  // invoice_sender.py:
  //   calculate_net(a)   = round(a / 1.24, 2)          # 2dp of a CENTS value
  //   format_currency(x) = f"{x / 100:.2f}"
  //   net = format_currency(calculate_net(amount))
  //   vat = format_currency(amount - calculate_net(amount))
  const legacy = (cents: number) => {
    const net2dp = Math.round((cents / 1.24) * 100) / 100; // round(x, 2)
    return {
      net: (net2dp / 100).toFixed(2),
      vat: ((cents - net2dp) / 100).toFixed(2),
    };
  };

  const divergences: string[] = [];
  for (let gross = 1; gross <= 50_000; gross++) {
    const now = splitGross(gross, 0.24);
    const old = legacy(gross);
    if (formatAmount(now.netCents) !== old.net || formatAmount(now.vatCents) !== old.vat) {
      divergences.push(
        `${gross}: new ${formatAmount(now.netCents)}/${formatAmount(now.vatCents)} ` +
          `vs legacy ${old.net}/${old.vat}`,
      );
    }
  }
  assert.deepEqual(divergences, [], `receipt values would change for ${divergences.length} amounts`);
});

test('formatAmount renders 2dp', () => {
  assert.equal(formatAmount(0), '0.00');
  assert.equal(formatAmount(5), '0.05');
  assert.equal(formatAmount(50), '0.50');
  assert.equal(formatAmount(2419), '24.19');
  assert.equal(formatAmount(100_000), '1000.00');
});

test('splitGross rejects nonsense rather than filing it', () => {
  assert.throws(() => splitGross(10.5, 0.24), /integer/);
  assert.throws(() => splitGross(-1, 0.24), />= 0/);
  assert.throws(() => splitGross(100, 1.24), /vatRate/);
  assert.throws(() => formatAmount(1.5), /integer/);
});
