// InvoicesDoc builder.
//
// The legacy pipeline parsed a template file and patched eight elements by
// XPath. That worked, but it meant the document's correctness depended on a
// file on disk staying in sync with the code, and a missed XPath failed silently
// (the template's placeholder value went to AADE instead).
//
// This builds the document from typed values instead. The element order,
// namespaces and fixed values are copied verbatim from the template that AADE
// has accepted ~22.4k times — including AADE's own misspelling of
// "incomeClassificaton" in the icls namespace URI, which is load-bearing.

import { formatAmount } from './money.ts';
import type { ReceiptInput } from './types.ts';

const NS = 'http://www.aade.gr/myDATA/invoice/v1.0';
const NS_XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const NS_ICLS = 'https://www.aade.gr/myDATA/incomeClassificaton/v1.0'; // sic — AADE's spelling
const NS_ECLS = 'https://www.aade.gr/myDATA/expensesClassificaton/v1.0'; // sic
const SCHEMA_LOCATION = 'http://www.aade.gr/myDATA/invoice/v1.0/InvoicesDoc-v0.6.xsd';

/** XML text escaping. Only `series` and `paymentMethodInfo` are free text, but
 *  an unescaped `&` would take down a whole day's filing, so escape everything. */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function assertReceipt(r: ReceiptInput): void {
  if (r.netCents + r.vatCents !== r.grossCents) {
    throw new Error(
      `buildInvoicesDoc: summary does not reconcile (${r.netCents} + ${r.vatCents} != ${r.grossCents})`,
    );
  }
  if (!Number.isInteger(r.aa) || r.aa <= 0) {
    throw new Error(`buildInvoicesDoc: aa must be a positive integer, got ${r.aa}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.issueDate)) {
    throw new Error(`buildInvoicesDoc: issueDate must be YYYY-MM-DD, got ${r.issueDate}`);
  }
  if (!r.series) throw new Error('buildInvoicesDoc: series is required');
}

/** Render a single-line retail receipt as a myDATA InvoicesDoc. */
export function buildInvoicesDoc(r: ReceiptInput): string {
  assertReceipt(r);

  const gross = formatAmount(r.grossCents);
  const net = formatAmount(r.netCents);
  const vat = formatAmount(r.vatCents);
  const t = r.tax;

  const classification = (indent: string) =>
    [
      `${indent}<incomeClassification>`,
      `${indent}\t<icls:classificationType>${esc(t.classification_type)}</icls:classificationType>`,
      `${indent}\t<icls:classificationCategory>${esc(t.classification_category)}</icls:classificationCategory>`,
      `${indent}\t<icls:amount>${net}</icls:amount>`,
      `${indent}</incomeClassification>`,
    ].join('\n');

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<InvoicesDoc xmlns="${NS}" xmlns:xsi="${NS_XSI}" xsi:schemaLocation="${SCHEMA_LOCATION}" xmlns:icls="${NS_ICLS}" xmlns:ecls="${NS_ECLS}">`,
    `\t<invoice>`,
    `\t\t<issuer>`,
    `\t\t\t<vatNumber>${esc(t.issuer_vat)}</vatNumber>`,
    `\t\t\t<country>GR</country>`,
    `\t\t\t<branch>${t.branch}</branch>`,
    `\t\t</issuer>`,
    `\t\t<invoiceHeader>`,
    `\t\t\t<series>${esc(r.series)}</series>`,
    `\t\t\t<aa>${r.aa}</aa>`,
    `\t\t\t<issueDate>${r.issueDate}</issueDate>`,
    `\t\t\t<invoiceType>${esc(t.invoice_type)}</invoiceType>`,
    `\t\t\t<currency>${esc(r.currency)}</currency>`,
    `\t\t</invoiceHeader>`,
    `\t\t<paymentMethods>`,
    `\t\t\t<paymentMethodDetails>`,
    `\t\t\t\t<type>${t.payment_method_type}</type>`,
    `\t\t\t\t<amount>${gross}</amount>`,
    `\t\t\t\t<paymentMethodInfo>${esc(r.paymentMethodInfo ?? 'Card')}</paymentMethodInfo>`,
    `\t\t\t</paymentMethodDetails>`,
    `\t\t</paymentMethods>`,
    `\t\t<invoiceDetails>`,
    `\t\t\t<lineNumber>1</lineNumber>`,
    `\t\t\t<netValue>${net}</netValue>`,
    `\t\t\t<vatCategory>${t.vat_category}</vatCategory>`,
    `\t\t\t<vatAmount>${vat}</vatAmount>`,
    classification('\t\t\t'),
    `\t\t</invoiceDetails>`,
    `\t\t<invoiceSummary>`,
    `\t\t\t<totalNetValue>${net}</totalNetValue>`,
    `\t\t\t<totalVatAmount>${vat}</totalVatAmount>`,
    `\t\t\t<totalWithheldAmount>0.00</totalWithheldAmount>`,
    `\t\t\t<totalFeesAmount>0.00</totalFeesAmount>`,
    `\t\t\t<totalStampDutyAmount>0.00</totalStampDutyAmount>`,
    `\t\t\t<totalOtherTaxesAmount>0.00</totalOtherTaxesAmount>`,
    `\t\t\t<totalDeductionsAmount>0.00</totalDeductionsAmount>`,
    `\t\t\t<totalGrossValue>${gross}</totalGrossValue>`,
    classification('\t\t\t'),
    `\t\t</invoiceSummary>`,
    `\t</invoice>`,
    `</InvoicesDoc>`,
  ].join('\n');
}
