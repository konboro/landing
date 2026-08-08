// Deterministic, offline, zero-network image placeholders.
// Everything is an inline SVG encoded as a `data:` URI so the panel renders the
// KYC gallery and avatars with no CDN, no Mapbox token and a strict CSP.
import { palette } from '@penny/ui';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function svgUri(svg: string): string {
  // encodeURIComponent keeps this valid inside CSS/img src and avoids base64 bloat.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const AVATAR_RAMPS: Array<[string, string]> = [
  [palette.blue400, palette.blue700],
  [palette.green400, palette.green500],
  ['#f0a35e', '#d2691e'],
  ['#a78bfa', '#6d28d9'],
  ['#f472b6', '#be185d'],
  ['#38bdf8', '#0369a1'],
  ['#fbbf24', '#b45309'],
  ['#34d399', '#047857'],
];

export function initialsOf(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Circular gradient avatar with the person's initials. */
export function avatarDataUri(name: string | null | undefined, seed: string): string {
  const ramp = AVATAR_RAMPS[hash(seed) % AVATAR_RAMPS.length]!;
  const text = esc(initialsOf(name));
  return svgUri(`
    <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${ramp[0]}"/>
          <stop offset="100%" stop-color="${ramp[1]}"/>
        </linearGradient>
      </defs>
      <rect width="160" height="160" rx="80" fill="url(#g)"/>
      <text x="80" y="80" fill="#ffffff" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif"
            font-size="62" font-weight="700" text-anchor="middle" dominant-baseline="central">${text}</text>
    </svg>`);
}

const DOC_LABEL: Record<string, string> = {
  ID_CARD: 'IDENTITY CARD',
  PASSPORT: 'PASSPORT',
  DRIVERS: 'DRIVING LICENCE',
  SELFIE: 'LIVENESS SELFIE',
  RESIDENCE_PERMIT: 'RESIDENCE PERMIT',
  UTILITY_BILL: 'PROOF OF ADDRESS',
};

const DOC_TINT: Record<string, [string, string]> = {
  ID_CARD: ['#e8eefb', '#c3d3f2'],
  PASSPORT: ['#e9f6ec', '#c6e6cf'],
  DRIVERS: ['#fdf1e3', '#f3d9b6'],
  SELFIE: ['#eee9fb', '#d5c9f3'],
  RESIDENCE_PERMIT: ['#eaf5f8', '#c5e2ea'],
  UTILITY_BILL: ['#f4f4f6', '#dcdce2'],
};

/**
 * A document-shaped placeholder that *looks* like the scan it stands in for:
 * photo box, field lines, MRZ strip and the doc type printed across it.
 * Used for the Sumsub gallery so the lightbox is visibly functional offline.
 */
export function documentDataUri(opts: {
  docType: string;
  subType?: string | null;
  name: string;
  docNumber?: string | null;
  country?: string | null;
  expiry?: string | null;
  rejected?: boolean;
}): string {
  const { docType, subType, name, docNumber, country, expiry, rejected } = opts;
  const tint = DOC_TINT[docType] ?? ['#eef1f6', '#d6dbe4'];
  const label = DOC_LABEL[docType] ?? docType;
  const isSelfie = docType === 'SELFIE';
  const back = subType === 'BACK_SIDE';
  const seed = hash(`${docType}${subType ?? ''}${name}`);
  const faceRamp = AVATAR_RAMPS[seed % AVATAR_RAMPS.length]!;

  const photo = isSelfie
    ? `<rect x="180" y="40" width="280" height="360" rx="18" fill="url(#face)"/>
       <circle cx="320" cy="170" r="72" fill="rgba(255,255,255,0.85)"/>
       <path d="M215 400 Q320 250 425 400 Z" fill="rgba(255,255,255,0.85)"/>`
    : back
      ? `<rect x="42" y="70" width="556" height="60" rx="6" fill="rgba(13,18,32,0.78)"/>
         <rect x="42" y="150" width="360" height="10" rx="5" fill="rgba(13,18,32,0.18)"/>
         <rect x="42" y="176" width="300" height="10" rx="5" fill="rgba(13,18,32,0.14)"/>
         <rect x="42" y="202" width="330" height="10" rx="5" fill="rgba(13,18,32,0.14)"/>`
      : `<rect x="42" y="70" width="150" height="185" rx="10" fill="url(#face)"/>
         <circle cx="117" cy="128" r="36" fill="rgba(255,255,255,0.85)"/>
         <path d="M62 255 Q117 165 172 255 Z" fill="rgba(255,255,255,0.85)"/>`;

  const fields = isSelfie
    ? `<text x="320" y="437" text-anchor="middle" font-size="19" fill="#0d1220" font-family="system-ui,sans-serif" font-weight="600">${esc(name)}</text>`
    : back
      ? ''
      : `<text x="214" y="96" font-size="12" fill="#5a6780" font-family="system-ui,sans-serif" letter-spacing="1.4">SURNAME / NAME</text>
         <text x="214" y="122" font-size="21" fill="#0d1220" font-family="system-ui,sans-serif" font-weight="600">${esc(name)}</text>
         <text x="214" y="156" font-size="12" fill="#5a6780" font-family="system-ui,sans-serif" letter-spacing="1.4">DOCUMENT No.</text>
         <text x="214" y="180" font-size="19" fill="#0d1220" font-family="ui-monospace,Menlo,monospace">${esc(docNumber ?? '—')}</text>
         <text x="214" y="214" font-size="12" fill="#5a6780" font-family="system-ui,sans-serif" letter-spacing="1.4">COUNTRY</text>
         <text x="214" y="238" font-size="17" fill="#0d1220" font-family="ui-monospace,Menlo,monospace">${esc(country ?? '—')}</text>
         <text x="404" y="214" font-size="12" fill="#5a6780" font-family="system-ui,sans-serif" letter-spacing="1.4">EXPIRY</text>
         <text x="404" y="238" font-size="17" fill="#0d1220" font-family="ui-monospace,Menlo,monospace">${esc(expiry ?? '—')}</text>`;

  const mrz = isSelfie
    ? ''
    : `<rect x="42" y="300" width="556" height="86" rx="8" fill="rgba(13,18,32,0.06)"/>
       <text x="58" y="332" font-size="17" fill="#38425c" font-family="ui-monospace,Menlo,monospace">P&lt;${esc((country ?? 'GRC').slice(0, 3).toUpperCase())}&lt;${esc(name.toUpperCase().replace(/\s+/g, '&lt;&lt;'))}&lt;&lt;&lt;&lt;&lt;&lt;</text>
       <text x="58" y="366" font-size="17" fill="#38425c" font-family="ui-monospace,Menlo,monospace">${esc((docNumber ?? '000000000').padEnd(10, '&lt;'))}${esc((country ?? 'GRC').slice(0, 3).toUpperCase())}${(seed % 9000 + 1000)}M${(seed % 8000 + 2000)}&lt;&lt;&lt;&lt;</text>`;

  const stamp = rejected
    ? `<g transform="rotate(-14 320 220)">
         <rect x="150" y="176" width="340" height="88" rx="10" fill="none" stroke="#e04141" stroke-width="7" opacity="0.75"/>
         <text x="320" y="234" text-anchor="middle" font-size="46" font-weight="700" fill="#e04141" opacity="0.75"
               font-family="system-ui,sans-serif" letter-spacing="4">REJECTED</text>
       </g>`
    : '';

  return svgUri(`
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="460" viewBox="0 0 640 460">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${tint[0]}"/>
          <stop offset="100%" stop-color="${tint[1]}"/>
        </linearGradient>
        <linearGradient id="face" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${faceRamp[0]}"/>
          <stop offset="100%" stop-color="${faceRamp[1]}"/>
        </linearGradient>
      </defs>
      <rect width="640" height="460" fill="#ffffff"/>
      <rect x="10" y="10" width="620" height="440" rx="16" fill="url(#bg)" stroke="rgba(13,18,32,0.12)"/>
      <text x="42" y="46" font-size="15" font-weight="700" letter-spacing="2.6" fill="#38425c"
            font-family="system-ui,sans-serif">${esc(label)}${subType ? ` · ${esc(subType.replace('_', ' '))}` : ''}</text>
      ${photo}
      ${fields}
      ${mrz}
      <text x="598" y="440" text-anchor="end" font-size="11" fill="#8a93a8" font-family="ui-monospace,Menlo,monospace">
        SUMSUB MOCK IMAGE · NOT A REAL DOCUMENT
      </text>
      ${stamp}
    </svg>`);
}
