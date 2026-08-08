// Client-generated UUIDs — the idempotency key for every outbox row.
// Prefer expo-crypto's native randomUUID; fall back to a v4 built on
// Math.random so unit tests / Expo Go always work.
let expoCrypto: { randomUUID?: () => string } | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  expoCrypto = require('expo-crypto');
} catch {
  expoCrypto = null;
}

export function uuid(): string {
  if (expoCrypto?.randomUUID) {
    try {
      return expoCrypto.randomUUID();
    } catch {
      /* fall through */
    }
  }
  return v4Fallback();
}

function v4Fallback(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
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

export function nowIso(): string {
  return new Date().toISOString();
}
