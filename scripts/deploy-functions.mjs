#!/usr/bin/env node
/**
 * Deploy Supabase Edge Functions straight through the Management API.
 *
 * Why not the CLI: `supabase functions deploy` needs either Docker (to bundle
 * locally) or, with --use-api, its own HTTP client — and the CLI's client does
 * not honour HTTPS_PROXY, so it dies with "TransportError" behind a proxy.
 * Node's fetch works fine here, so we drive the same endpoint directly.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/deploy-functions.mjs --project-ref <ref> [--only a,b]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EDGE = join(ROOT, 'services', 'edge');
const FUNCS = join(EDGE, 'functions');
const API = 'https://api.supabase.com/v1';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const REF = arg('project-ref');
const ONLY = arg('only');
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN is required'); process.exit(1); }
if (!REF) { console.error('--project-ref is required'); process.exit(1); }

/** Provider webhooks and public feeds must be reachable without a Supabase JWT. */
const NO_JWT = new Set(['payments-webhook', 'sumsub-webhook', 'gbfs']);

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

// Every function shares _shared/*, so upload it alongside each one. Paths are
// kept relative to services/edge/ so `../../_shared/x.ts` still resolves.
const sharedFiles = walk(join(EDGE, '_shared'));

async function deploy(slug) {
  const dir = join(FUNCS, slug);
  const files = [...walk(dir), ...sharedFiles];

  const form = new FormData();
  form.append(
    'metadata',
    new Blob(
      [JSON.stringify({
        name: slug,
        entrypoint_path: `functions/${slug}/index.ts`,
        import_map_path: null,
        static_patterns: [],
        verify_jwt: !NO_JWT.has(slug),
      })],
      { type: 'application/json' },
    ),
  );
  for (const f of files) {
    // POSIX separators always: on Windows relative() yields `functions\slug\index.ts`,
    // which the API stores verbatim and then cannot match against the forward-slash
    // entrypoint_path above ("Entrypoint path does not exist").
    const rel = relative(EDGE, f).split(sep).join('/');
    form.append('file', new Blob([readFileSync(f)], { type: 'text/typescript' }), rel);
  }

  const res = await fetch(`${API}/projects/${REF}/functions/deploy?slug=${encodeURIComponent(slug)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: form,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text.slice(0, 300) };
}

const slugs = (ONLY ? ONLY.split(',') : readdirSync(FUNCS))
  .map((s) => s.trim())
  .filter((s) => s && statSync(join(FUNCS, s)).isDirectory())
  .sort();

console.log(`Deploying ${slugs.length} function(s) to ${REF}\n`);
let pass = 0;
const failed = [];
for (const slug of slugs) {
  process.stdout.write(`  ${slug.padEnd(28)}`);
  try {
    const r = await deploy(slug);
    if (r.ok) { console.log('✓'); pass++; }
    else { console.log(`✗ ${r.status} ${r.body}`); failed.push(slug); }
  } catch (e) {
    console.log(`✗ ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
    failed.push(slug);
  }
}
console.log(`\n${pass}/${slugs.length} deployed`);
if (failed.length) { console.log(`failed: ${failed.join(', ')}`); process.exit(1); }
