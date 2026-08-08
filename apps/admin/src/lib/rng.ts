// Deterministic seeded PRNG so mock data is stable across reloads/builds.
export class Rng {
  private s: number;
  constructor(seed = 1337) {
    this.s = seed >>> 0;
  }
  next(): number {
    // mulberry32
    this.s |= 0;
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  float(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }
  bool(p = 0.5): boolean {
    return this.next() < p;
  }
  /** RFC4122-ish uuid from the seeded stream (stable, not cryptographic). */
  uuid(): string {
    const hex = '0123456789abcdef';
    let out = '';
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
      else if (i === 14) out += '4';
      else if (i === 19) out += hex[(Math.floor(this.next() * 4) + 8)]!;
      else out += hex[Math.floor(this.next() * 16)]!;
    }
    return out;
  }
}

export function uuid(): string {
  // Non-deterministic id for runtime-created rows (audit entries, etc.).
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
