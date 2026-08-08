// Client-generated ids for idempotent mutations (Hard Rule: every money/unlock
// mutation carries a client-generated id so retries never double-charge).

/** RFC4122-ish v4 uuid. Uses crypto.getRandomValues when present, else Math. */
export function uuid(): string {
  const bytes = new Uint8Array(16);
  const g: Crypto | undefined =
    typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (g && typeof g.getRandomValues === 'function') {
    g.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < 256; i++) hex.push((i + 0x100).toString(16).slice(1));
  const b = bytes;
  return (
    hex[b[0]!]! + hex[b[1]!]! + hex[b[2]!]! + hex[b[3]!]! + '-' +
    hex[b[4]!]! + hex[b[5]!]! + '-' +
    hex[b[6]!]! + hex[b[7]!]! + '-' +
    hex[b[8]!]! + hex[b[9]!]! + '-' +
    hex[b[10]!]! + hex[b[11]!]! + hex[b[12]!]! + hex[b[13]!]! + hex[b[14]!]! + hex[b[15]!]!
  );
}

/** Short human code, e.g. for referral / promo previews. */
export function shortCode(len = 6): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
