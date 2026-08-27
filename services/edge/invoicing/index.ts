// services/edge/invoicing — the e-invoicing adapter seam docs/05 specifies.
//
// The implementation behind it talks to AADE directly. See docs/18-mydata.md.
export * from './types.ts';
export * from './money.ts';
export * from './xml.ts';
export * from './parse.ts';
export * from './guards.ts';
export * from './legacy.ts';
export { AadeAdapter } from './aade.ts';
export type { AadeAdapterOptions } from './aade.ts';
