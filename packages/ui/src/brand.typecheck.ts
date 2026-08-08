// Compile-time assertions for the brand system.
//
// This file exists because `*.test.ts` is excluded from `tsc` (those run under
// `node --test`, which strips types without checking them). Type-level bugs —
// like DeepPartial failing to make nested interface fields optional — are
// invisible to the runtime tests, so they are asserted here instead and caught
// by `pnpm typecheck`.
//
// Nothing is exported for runtime use; the file is pure type pressure.

import { createBrand, brandFromConfig, type Brand, type DeepPartial } from './brand.js';

/* A partial nested override must compile — this is the core ergonomic. */
const oneColor = createBrand({ colors: { primary: '#ff5a1f' } });

/* Several nested objects, each only partially specified. */
const manyPartials = createBrand({
  id: 'acme',
  name: 'Acme Go',
  colors: { primary: '#ff5a1f', onPrimary: '#ffffff' },
  darkColors: { bg: '#101010' },
  assets: { monogram: 'A' },
  typography: { scale: 1.1 },
  shape: { radiusScale: 2 },
  support: { email: 'help@acmego.com' },
  legal: { legalName: 'Acme Mobility Ltd' },
  maps: { styleDay: 'mapbox://styles/acme/day' },
  features: { groupRides: false },
});

/* An empty override is valid (returns the default brand). */
const empty = createBrand({});
const noArg = createBrand();

/* The result is always a COMPLETE Brand, never a partial. */
const complete: Brand = manyPartials;
const stillComplete: Brand = brandFromConfig({ name: 'From config' });

/* Nullable primitives stay assignable both ways. */
const nullable = createBrand({ support: { phone: null }, assets: { wordmark: '<svg/>' } });

/* String-keyed records accept a subset of keys. */
const someFlags: DeepPartial<Brand> = { features: { loyalty: false } };

/* Reference every binding so `noUnusedLocals` stays satisfied wherever this
   file is compiled. */
export type __BrandTypeAssertions = [
  typeof oneColor,
  typeof manyPartials,
  typeof empty,
  typeof noArg,
  typeof complete,
  typeof stillComplete,
  typeof nullable,
  typeof someFlags,
];
