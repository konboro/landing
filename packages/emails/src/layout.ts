// Dependency-free HTML email builder. Edge functions render these and send via Resend.
// Kept framework-free so it compiles without installs; swap for react-email later if desired.

import type { Lang } from '@penny/db-types';

const BRAND = '#2f5be0';
const INK = '#0d1220';
const MUTED = '#8a93a8';

export interface EmailDoc {
  subject: string;
  html: string;
  text: string;
}

export function shell(opts: { title: string; bodyHtml: string; lang: Lang; preheader?: string }): string {
  const { title, bodyHtml, preheader = '' } = opts;
  return `<!doctype html><html lang="${opts.lang}"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escape(title)}</title></head>
<body style="margin:0;background:#f6f8fb;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${INK};">
<span style="display:none;opacity:0;color:transparent;height:0;width:0">${escape(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fb;padding:24px 0">
<tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(13,18,32,.08)">
<tr><td style="background:${BRAND};padding:20px 28px">
<span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:.5px">Penny</span>
</td></tr>
<tr><td style="padding:28px">${bodyHtml}</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #eceff4;color:${MUTED};font-size:12px">
Penny.rent · Athens, Greece<br/>
You can manage notifications in the app · Profile → Notifications
</td></tr>
</table>
</td></tr></table></body></html>`;
}

export function button(label: string, href: string): string {
  return `<a href="${escape(href)}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600;font-size:15px">${escape(label)}</a>`;
}

export function h1(t: string): string {
  return `<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25">${escape(t)}</h1>`;
}
export function p(t: string): string {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.5;color:${INK}">${t}</p>`;
}
export function muted(t: string): string {
  return `<p style="margin:0 0 8px;font-size:13px;color:${MUTED}">${escape(t)}</p>`;
}

export function escape(s: string): string {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
