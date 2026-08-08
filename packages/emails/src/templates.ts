// Transactional + lifecycle email templates (docs/12 C), PL/EN/EL.
// Each returns an EmailDoc; edge functions pick language from user prefs.

import type { Lang } from '@penny/db-types';
import { shell, button, h1, p, muted, stripHtml, escape, type EmailDoc } from './layout.js';

type Dict = Record<Lang, string>;
const pick = (d: Dict, lang: Lang) => d[lang] ?? d.en;

function doc(lang: Lang, subject: string, bodyHtml: string, preheader?: string): EmailDoc {
  const html = shell({ title: subject, bodyHtml, lang, preheader });
  return { subject, html, text: stripHtml(bodyHtml) };
}

export function tripReceipt(
  lang: Lang,
  data: { amount: string; distance: string; duration: string; date: string; receiptUrl: string },
): EmailDoc {
  const subject = pick(
    { en: `Your Penny ride receipt — ${data.amount}`, pl: `Rachunek za przejazd Penny — ${data.amount}`, el: `Απόδειξη διαδρομής Penny — ${data.amount}` },
    lang,
  );
  const t = pick({ en: 'Thanks for riding!', pl: 'Dziękujemy za przejazd!', el: 'Ευχαριστούμε για τη διαδρομή!' }, lang);
  const body =
    h1(t) +
    p(
      pick(
        {
          en: `Distance <b>${escape(data.distance)}</b> · Duration <b>${escape(data.duration)}</b>`,
          pl: `Dystans <b>${escape(data.distance)}</b> · Czas <b>${escape(data.duration)}</b>`,
          el: `Απόσταση <b>${escape(data.distance)}</b> · Διάρκεια <b>${escape(data.duration)}</b>`,
        },
        lang,
      ),
    ) +
    p(`<b style="font-size:20px">${escape(data.amount)}</b>`) +
    muted(data.date) +
    `<div style="margin-top:16px">${button(pick({ en: 'View receipt (PDF)', pl: 'Zobacz rachunek (PDF)', el: 'Δείτε απόδειξη (PDF)' }, lang), data.receiptUrl)}</div>`;
  return doc(lang, subject, body, t);
}

export function paymentFailed(lang: Lang, data: { amount: string; payUrl: string }): EmailDoc {
  const subject = pick({ en: 'Payment failed — action needed', pl: 'Płatność nieudana — wymagane działanie', el: 'Αποτυχία πληρωμής — απαιτείται ενέργεια' }, lang);
  const body =
    h1(subject) +
    p(pick({ en: `We couldn't charge <b>${escape(data.amount)}</b> for your last ride. Please settle it to keep riding.`, pl: `Nie udało się pobrać <b>${escape(data.amount)}</b> za ostatni przejazd. Ureguluj, aby jeździć dalej.`, el: `Δεν μπορέσαμε να χρεώσουμε <b>${escape(data.amount)}</b>. Παρακαλώ τακτοποιήστε το.` }, lang)) +
    `<div style="margin-top:16px">${button(pick({ en: 'Pay now', pl: 'Zapłać teraz', el: 'Πληρωμή τώρα' }, lang), data.payUrl)}</div>`;
  return doc(lang, subject, body);
}

export function kycResult(lang: Lang, data: { approved: boolean; reason?: string; retryUrl: string }): EmailDoc {
  if (data.approved) {
    const subject = pick({ en: "You're verified — ready to ride", pl: 'Weryfikacja zakończona — możesz jeździć', el: 'Επαληθεύτηκες — έτοιμος για διαδρομή' }, lang);
    return doc(lang, subject, h1(subject) + p(pick({ en: 'Your identity check passed. Unlock your first scooter now!', pl: 'Weryfikacja tożsamości zakończona sukcesem. Odblokuj pierwszą hulajnogę!', el: 'Ο έλεγχος ταυτότητας ολοκληρώθηκε. Ξεκλείδωσε το πρώτο σκούτερ!' }, lang)));
  }
  const subject = pick({ en: 'Verification needs another try', pl: 'Weryfikacja wymaga ponowienia', el: 'Η επαλήθευση χρειάζεται νέα προσπάθεια' }, lang);
  const body = h1(subject) + p(escape(data.reason ?? '')) + `<div style="margin-top:16px">${button(pick({ en: 'Retry verification', pl: 'Spróbuj ponownie', el: 'Νέα προσπάθεια' }, lang), data.retryUrl)}</div>`;
  return doc(lang, subject, body);
}

export function penaltyIssued(lang: Lang, data: { amount: string; reason: string; photoUrl?: string; appealUrl: string }): EmailDoc {
  const subject = pick({ en: `A penalty was applied — ${data.amount}`, pl: `Naliczono opłatę — ${data.amount}`, el: `Εφαρμόστηκε ποινή — ${data.amount}` }, lang);
  const body =
    h1(subject) +
    p(escape(data.reason)) +
    (data.photoUrl ? `<img src="${escape(data.photoUrl)}" width="424" style="border-radius:12px;margin:8px 0;max-width:100%"/>` : '') +
    `<div style="margin-top:16px">${button(pick({ en: 'Appeal', pl: 'Odwołaj się', el: 'Ένσταση' }, lang), data.appealUrl)}</div>`;
  return doc(lang, subject, body);
}

export function welcome(lang: Lang, data: { name: string }): EmailDoc {
  const subject = pick({ en: 'Welcome to Penny 🛴', pl: 'Witamy w Penny 🛴', el: 'Καλώς ήρθες στην Penny 🛴' }, lang);
  const body = h1(pick({ en: `Hi ${escape(data.name)},`, pl: `Cześć ${escape(data.name)},`, el: `Γεια σου ${escape(data.name)},` }, lang)) + p(pick({ en: 'Your account is ready. Open the map, find a scooter, and scan to ride. First ride tips are in the app tutorial.', pl: 'Twoje konto jest gotowe. Otwórz mapę, znajdź hulajnogę i zeskanuj kod. Wskazówki w samouczku aplikacji.', el: 'Ο λογαριασμός σου είναι έτοιμος. Άνοιξε τον χάρτη, βρες σκούτερ και σκάναρε.' }, lang));
  return doc(lang, subject, body, subject);
}

/** Weekly owner report — the "Monday morning" mail (docs/12 B). */
export function ownerWeekly(
  lang: Lang,
  data: { revenue: string; rides: number; utilization: string; debtAging: string; fleetHealth: string; topAlerts: string[] },
): EmailDoc {
  const subject = pick({ en: 'Penny — weekly operations report', pl: 'Penny — tygodniowy raport operacyjny', el: 'Penny — εβδομαδιαία αναφορά' }, lang);
  const rows = [
    ['Revenue', data.revenue],
    ['Rides', String(data.rides)],
    ['Utilization', data.utilization],
    ['Debt aging', data.debtAging],
    ['Fleet health', data.fleetHealth],
  ]
    .map(([k, v]) => `<tr><td style="padding:6px 0;color:#8a93a8">${k}</td><td style="padding:6px 0;text-align:right;font-weight:600">${escape(v!)}</td></tr>`)
    .join('');
  const alerts = data.topAlerts.map((a) => `<li>${escape(a)}</li>`).join('');
  const body = h1(subject) + `<table width="100%">${rows}</table>` + (alerts ? `<h3 style="margin:16px 0 6px">Top alerts</h3><ul style="margin:0;padding-left:18px">${alerts}</ul>` : '');
  return doc(lang, subject, body);
}

export const templates = { tripReceipt, paymentFailed, kycResult, penaltyIssued, welcome, ownerWeekly };
export type TemplateName = keyof typeof templates;
