import { strict as assert } from 'node:assert';
import test from 'node:test';
import { buildInvoicesDoc, esc } from './xml.ts';
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

function receipt(over: Partial<ReceiptInput> = {}): ReceiptInput {
  const gross = over.grossCents ?? 3000;
  const { netCents, vatCents } = splitGross(gross, TAX.vat_rate);
  return {
    series: 'ΑΠΥ',
    aa: 23108,
    issueDate: '2026-08-14',
    grossCents: gross,
    netCents,
    vatCents,
    currency: 'EUR',
    tax: TAX,
    ...over,
  };
}

/** Ordered [tag, text] pairs for every leaf element — structure without formatting. */
function leaves(xml: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const re = /<([A-Za-z0-9_.:-]+)(?:\s[^>]*)?>([^<]*)<\/\1>/g;
  for (const m of xml.matchAll(re)) {
    const text = m[2].trim();
    if (text !== '') out.push([m[1].replace(/^[A-Za-z0-9_.-]+:/, ''), text]);
  }
  return out;
}

// edited_invoice.xml — the last document the PythonAnywhere pipeline produced
// before the export (AA 23108, 2026-08-14, EUR 30.00). Reproducing it exactly is
// the strongest available evidence that the port changes nothing AADE can see.
const GOLDEN_AA_23108 = `<?xml version='1.0' encoding='UTF-8'?>
<InvoicesDoc xmlns="http://www.aade.gr/myDATA/invoice/v1.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:icls="https://www.aade.gr/myDATA/incomeClassificaton/v1.0" xmlns:ecls="https://www.aade.gr/myDATA/expensesClassificaton/v1.0" xsi:schemaLocation="http://www.aade.gr/myDATA/invoice/v1.0/InvoicesDoc-v0.6.xsd">
	<invoice>
		<issuer>
			<vatNumber>802160515</vatNumber>
			<country>GR</country>
			<branch>1</branch>
		</issuer>
		<invoiceHeader>
			<series>ΑΠΥ</series>
			<aa>23108</aa>
			<issueDate>2026-08-14</issueDate>
			<invoiceType>11.2</invoiceType>
			<currency>EUR</currency>
		</invoiceHeader>
		<paymentMethods>
			<paymentMethodDetails>
				<type>6</type>
				<amount>30.00</amount>
				<paymentMethodInfo>Card</paymentMethodInfo>
			</paymentMethodDetails>
		</paymentMethods>
		<invoiceDetails>
			<lineNumber>1</lineNumber>
			<netValue>24.19</netValue>
			<vatCategory>1</vatCategory>
			<vatAmount>5.81</vatAmount>
			<incomeClassification>
				<icls:classificationType>E3_561_003</icls:classificationType>
				<icls:classificationCategory>category1_3</icls:classificationCategory>
				<icls:amount>24.19</icls:amount>
			</incomeClassification>
		</invoiceDetails>
		<invoiceSummary>
			<totalNetValue>24.19</totalNetValue>
			<totalVatAmount>5.81</totalVatAmount>
			<totalWithheldAmount>0.00</totalWithheldAmount>
			<totalFeesAmount>0.00</totalFeesAmount>
			<totalStampDutyAmount>0.00</totalStampDutyAmount>
			<totalOtherTaxesAmount>0.00</totalOtherTaxesAmount>
			<totalDeductionsAmount>0.00</totalDeductionsAmount>
			<totalGrossValue>30.00</totalGrossValue>
			<incomeClassification>
				<icls:classificationType>E3_561_003</icls:classificationType>
				<icls:classificationCategory>category1_3</icls:classificationCategory>
				<icls:amount>24.19</icls:amount>
			</incomeClassification>
		</invoiceSummary>
    </invoice>
</InvoicesDoc>`;

test('reproduces the last document the legacy pipeline filed (AA 23108)', () => {
  assert.deepEqual(leaves(buildInvoicesDoc(receipt())), leaves(GOLDEN_AA_23108));
});

test('carries the namespaces AADE expects, including their own misspelling', () => {
  const xml = buildInvoicesDoc(receipt());
  assert.match(xml, /xmlns="http:\/\/www\.aade\.gr\/myDATA\/invoice\/v1\.0"/);
  // "incomeClassificaton" is missing an 'i' in AADE's schema. Correcting it
  // would produce a document they reject.
  assert.match(xml, /xmlns:icls="https:\/\/www\.aade\.gr\/myDATA\/incomeClassificaton\/v1\.0"/);
  assert.match(xml, /xmlns:ecls="https:\/\/www\.aade\.gr\/myDATA\/expensesClassificaton\/v1\.0"/);
  assert.match(xml, /xsi:schemaLocation="[^"]*InvoicesDoc-v0\.6\.xsd"/);
});

test('the classification amount follows net, in both blocks', () => {
  const xml = buildInvoicesDoc(receipt({ grossCents: 1240 }));
  const amounts = [...xml.matchAll(/<icls:amount>([\d.]+)<\/icls:amount>/g)].map((m) => m[1]);
  assert.deepEqual(amounts, ['10.00', '10.00']);
});

test('the Greek series survives serialisation', () => {
  assert.match(buildInvoicesDoc(receipt()), /<series>ΑΠΥ<\/series>/);
});

test('refuses to render a document AADE would reject', () => {
  assert.throws(
    () => buildInvoicesDoc(receipt({ netCents: 2400, vatCents: 581, grossCents: 3000 })),
    /reconcile/,
  );
  assert.throws(() => buildInvoicesDoc(receipt({ aa: 0 })), /positive integer/);
  assert.throws(() => buildInvoicesDoc(receipt({ issueDate: '14-08-2026' })), /YYYY-MM-DD/);
  assert.throws(() => buildInvoicesDoc(receipt({ series: '' })), /series is required/);
});

test('escapes free text', () => {
  assert.equal(esc(`a&b<c>"d"'e'`), 'a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;');
  const xml = buildInvoicesDoc(receipt({ paymentMethodInfo: 'Card & wallet' }));
  assert.match(xml, /<paymentMethodInfo>Card &amp; wallet<\/paymentMethodInfo>/);
});

test('renders every amount as 2dp', () => {
  for (const gross of [1, 99, 100, 3000, 12345, 99999]) {
    const xml = buildInvoicesDoc(receipt({ grossCents: gross }));
    for (const m of xml.matchAll(/<(?:total)?(?:net|Net)[A-Za-z]*>([^<]+)</g)) {
      assert.match(m[1], /^\d+\.\d{2}$/, `bad amount format ${m[1]} at gross ${gross}`);
    }
  }
});
