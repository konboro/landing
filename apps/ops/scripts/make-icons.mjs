#!/usr/bin/env node
/**
 * Generate the Ops app's launcher/splash icons.
 *
 * Why this exists: `apps/ops/assets/*.png` shipped as 70-byte placeholders that
 * are not valid PNGs at all (broken chunk table), and `expo prebuild` dies on
 * them while generating the Android mipmaps:
 *
 *   [android.dangerous]: withAndroidDangerousBaseMod: Crc error - 25199785 …
 *
 * Copying the rider's icons would fix the build and leave two identical icons
 * on a field phone that has both apps installed, so the mark is deliberately
 * different: rider is the scooter app, ops is the wrench.
 *
 * Encoder is written out longhand (RGBA, filter 0, one zlib stream) because
 * this is the only thing in the repo that needs to write an image, and adding
 * an image dependency for four files is a worse trade.
 *
 *   node apps/ops/scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const assets = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
mkdirSync(assets, { recursive: true });

const BG = [0x11, 0x1f, 0x52]; // brand.splash — the dark navy
const FG = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @param {(x:number,y:number)=>[number,number,number,number]} shade */
function png(size, shade) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = shade(x, y);
      raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * A wrench: a ring with a bite taken out of its top-left, and a shaft running
 * down to the bottom-right. Distance fields keep the edges smooth without any
 * rasteriser.
 */
function wrenchAlpha(x, y, size) {
  const u = (x + 0.5) / size, v = (y + 0.5) / size;   // 0..1
  const soft = 1.6 / size;                             // ~1.5px feather
  const cover = (d) => Math.max(0, Math.min(1, 0.5 - d / soft));

  // Ring (the jaw), centred up-left.
  const cx = 0.36, cy = 0.34, rOuter = 0.20, rInner = 0.108;
  const dr = Math.hypot(u - cx, v - cy);
  let a = Math.min(cover(dr - rOuter), cover(rInner - dr));

  // The opening: cut a wedge out of the ring towards the upper-left.
  const ang = Math.atan2(v - cy, u - cx);              // -pi..pi
  const gapCentre = Math.PI * 1.25 - 2 * Math.PI;      // up-left
  let dAng = Math.abs(ang - gapCentre);
  if (dAng > Math.PI) dAng = 2 * Math.PI - dAng;
  if (dr > rInner * 0.6 && dAng < 0.42) a = 0;

  // Shaft: a capsule from just inside the ring down to the lower right.
  const ax = cx + 0.10, ay = cy + 0.10, bx = 0.74, by = 0.74, half = 0.072;
  const vx = bx - ax, vy = by - ay;
  const t = Math.max(0, Math.min(1, ((u - ax) * vx + (v - ay) * vy) / (vx * vx + vy * vy)));
  const ds = Math.hypot(u - (ax + t * vx), v - (ay + t * vy));
  return Math.max(a, cover(ds - half));
}

const mix = (alpha, over, under) => [
  Math.round(over[0] * alpha + under[0] * (1 - alpha)),
  Math.round(over[1] * alpha + under[1] * (1 - alpha)),
  Math.round(over[2] * alpha + under[2] * (1 - alpha)),
  255,
];

const solid = (size) => png(size, (x, y) => mix(wrenchAlpha(x, y, size), FG, BG));
// Adaptive icons get their background from the manifest, and Android masks the
// outer ~25%, so the mark rides on transparency and stays inside the safe zone.
const adaptive = (size) => png(size, (x, y) => {
  const s = 0.72, off = (1 - s) / 2;
  const u = (x / size - off) / s, v = (y / size - off) / s;
  if (u < 0 || u > 1 || v < 0 || v > 1) return [0, 0, 0, 0];
  const a = wrenchAlpha(u * size, v * size, size);
  return [FG[0], FG[1], FG[2], Math.round(a * 255)];
});

const files = [
  ['icon.png', solid(1024)],
  ['splash-icon.png', solid(1024)],
  ['adaptive-icon.png', adaptive(1024)],
  ['favicon.png', solid(48)],
];
for (const [name, buf] of files) {
  writeFileSync(join(assets, name), buf);
  console.log(`${name.padEnd(20)} ${(buf.length / 1024).toFixed(1)} kB`);
}
