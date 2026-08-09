#!/usr/bin/env node
/**
 * Penny Platform — one-command Supabase provisioning.
 *
 * Creates a project on YOUR Supabase account, applies every migration in
 * supabase/migrations, sets function secrets, deploys the edge functions, and
 * writes ready-to-use .env.local files for admin / rider / ops.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/provision-supabase.mjs --env dev
 *
 * Get the token at: https://supabase.com/dashboard/account/tokens
 *
 * Flags:
 *   --env dev|prod            project name suffix + which .env files to write   (default: dev)
 *   --name <name>             explicit project name                    (default: penny-<env>)
 *   --org <org_id>            organization id (default: your only org; required if several)
 *   --region <region>         default eu-central-1 (Frankfurt — closest to Greece)
 *   --project-ref <ref>       skip creation, target an EXISTING project
 *   --db-password <pw>        default: generated (printed once, also saved to .env)
 *   --plan free|pro           default: free
 *   --skip-migrations         don't apply SQL
 *   --skip-functions          don't deploy edge functions
 *   --dry-run                 show what would happen, change nothing
 *
 * Everything is idempotent-ish: re-running with --project-ref re-applies
 * migrations (they are written to be re-appliable) and re-deploys functions.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.supabase.com/v1';

// ── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name, fallback = undefined) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const ENV = arg('env', 'dev');
const PROJECT_NAME = arg('name', `penny-${ENV}`);
const REGION = arg('region', 'eu-central-1');
const PLAN = arg('plan', 'free');
const ORG_ID = arg('org');
const EXISTING_REF = arg('project-ref');
const DRY = flag('dry-run');
const SKIP_MIGRATIONS = flag('skip-migrations');
const SKIP_FUNCTIONS = flag('skip-functions');

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || arg('token');

// ── tiny console helpers ──────────────────────────────────────────────────
const c = {
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  cy: (s) => `\x1b[36m${s}\x1b[0m`,
};
const step = (s) => console.log(`\n${c.cy('▶')} ${c.b(s)}`);
const ok = (s) => console.log(`  ${c.g('✓')} ${s}`);
const warn = (s) => console.log(`  ${c.y('!')} ${s}`);
const die = (s) => {
  console.error(`\n${c.r('✗')} ${s}\n`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── API ───────────────────────────────────────────────────────────────────
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const msg = typeof json === 'object' && json?.message ? json.message : text;
    throw new Error(`${method} ${path} → ${res.status}: ${msg}`);
  }
  return json;
}

function genPassword() {
  // URL/psql-safe: no @ : / ? # characters that break connection strings.
  return randomBytes(24).toString('base64url').slice(0, 28);
}

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(c.b('\nPenny Platform — Supabase provisioning'));
  console.log(c.dim(`env=${ENV} name=${PROJECT_NAME} region=${REGION} plan=${PLAN}${DRY ? ' [DRY RUN]' : ''}`));

  if (!TOKEN) {
    die(
      `No Supabase access token.\n\n` +
        `  1. Open ${c.cy('https://supabase.com/dashboard/account/tokens')}\n` +
        `  2. Generate a token ("Penny provisioning")\n` +
        `  3. Run:\n\n` +
        `     ${c.b('SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/provision-supabase.mjs --env dev')}\n`,
    );
  }

  let ref = EXISTING_REF;
  let dbPassword = arg('db-password') || genPassword();

  if (!ref) {
    // ── pick organization ──────────────────────────────────────────────
    step('Finding your organization');
    let orgs;
    try {
      orgs = await api('/organizations');
    } catch (e) {
      if (DRY) {
        warn(`Could not reach the API (${e.message.slice(0, 60)}) — continuing dry run.`);
        orgs = [{ id: 'dry-org', name: '(dry-run org)' }];
      } else throw e;
    }
    if (!Array.isArray(orgs) || orgs.length === 0) die('No organizations on this account.');
    let org = ORG_ID ? orgs.find((o) => o.id === ORG_ID) : orgs[0];
    if (!org) die(`Organization ${ORG_ID} not found. Available: ${orgs.map((o) => `${o.name} (${o.id})`).join(', ')}`);
    if (!ORG_ID && orgs.length > 1) {
      warn(`Several orgs found; using "${org.name}". Override with --org <id>.`);
      orgs.forEach((o) => console.log(c.dim(`      ${o.name} — ${o.id}`)));
    }
    ok(`Organization: ${org.name} (${org.id})`);

    // ── reuse or create project ────────────────────────────────────────
    step('Creating project');
    let projects = [];
    try {
      projects = await api('/projects');
    } catch (e) {
      if (!DRY) throw e;
      warn(`Could not list projects (${e.message.slice(0, 50)}) — continuing dry run.`);
    }
    const existing = Array.isArray(projects) ? projects.find((p) => p.name === PROJECT_NAME) : null;
    if (existing) {
      ref = existing.id;
      warn(`Project "${PROJECT_NAME}" already exists (${ref}) — reusing it.`);
      warn(`Its DB password is not retrievable; pass --db-password if you need SQL over psql.`);
    } else if (DRY) {
      ok(`[dry-run] would create "${PROJECT_NAME}" in ${REGION}`);
      ref = 'dryrunref';
    } else {
      const created = await api('/projects', {
        method: 'POST',
        body: {
          name: PROJECT_NAME,
          organization_id: org.id,
          region: REGION,
          db_pass: dbPassword,
          plan: PLAN,
        },
      });
      ref = created.id ?? created.ref;
      ok(`Created project ${PROJECT_NAME} (${ref})`);
    }
  } else {
    ok(`Using existing project ${ref}`);
  }

  // ── wait until healthy ───────────────────────────────────────────────
  if (!DRY) {
    step('Waiting for the project to come up (this takes a few minutes)');
    const deadline = Date.now() + 12 * 60 * 1000;
    let status = '';
    while (Date.now() < deadline) {
      try {
        const p = await api(`/projects/${ref}`);
        status = p.status ?? 'UNKNOWN';
        if (status === 'ACTIVE_HEALTHY') break;
      } catch (e) {
        status = `(${e.message.slice(0, 60)})`;
      }
      process.stdout.write(`\r  ${c.dim(`status: ${status} …`)}          `);
      await sleep(10_000);
    }
    process.stdout.write('\r');
    if (status !== 'ACTIVE_HEALTHY') die(`Project not healthy in time (last status: ${status}).`);
    ok('Project is ACTIVE_HEALTHY');
  }

  // ── keys ─────────────────────────────────────────────────────────────
  step('Fetching API keys');
  let anonKey = 'DRY_RUN_ANON';
  let serviceKey = 'DRY_RUN_SERVICE';
  if (!DRY) {
    const keys = await api(`/projects/${ref}/api-keys`);
    anonKey = keys.find((k) => k.name === 'anon')?.api_key ?? '';
    serviceKey = keys.find((k) => k.name === 'service_role')?.api_key ?? '';
    if (!anonKey || !serviceKey) die('Could not read anon/service_role keys.');
    ok('Got anon + service_role keys');
  }
  const projectUrl = `https://${ref}.supabase.co`;

  // ── migrations ───────────────────────────────────────────────────────
  if (!SKIP_MIGRATIONS) {
    step('Applying migrations');
    const dir = join(ROOT, 'supabase', 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    ok(`${files.length} migration files`);
    if (DRY) {
      files.forEach((f) => console.log(c.dim(`      would apply ${f}`)));
    } else {
      for (const f of files) {
        const sql = readFileSync(join(dir, f), 'utf8');
        process.stdout.write(`  ${c.dim(`applying ${f} …`)}`);
        try {
          await api(`/projects/${ref}/database/query`, { method: 'POST', body: { query: sql } });
          process.stdout.write(`\r  ${c.g('✓')} ${f}${' '.repeat(30)}\n`);
        } catch (e) {
          process.stdout.write('\r');
          die(`Migration ${f} failed:\n    ${e.message}`);
        }
      }
      ok('All migrations applied');
    }
  }

  // ── secrets ──────────────────────────────────────────────────────────
  // ── storage buckets ──────────────────────────────────────────────────
  // All private: trip photos and ops photos are user content, kyc-docs holds
  // identity documents (Hard Rule #11 — never public, always signed URLs).
  step('Creating storage buckets');
  const BUCKETS = [
    { id: 'trip-photos', public: false, fileSizeLimit: 10_485_760 },
    { id: 'ops-photos', public: false, fileSizeLimit: 10_485_760 },
    { id: 'kyc-docs', public: false, fileSizeLimit: 10_485_760 },
  ];
  if (DRY) {
    BUCKETS.forEach((b) => console.log(c.dim(`      would create private bucket ${b.id}`)));
  } else {
    for (const bucket of BUCKETS) {
      try {
        const res = await fetch(`${projectUrl}/storage/v1/bucket`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: bucket.id,
            name: bucket.id,
            public: bucket.public,
            file_size_limit: bucket.fileSizeLimit,
          }),
        });
        if (res.ok) ok(`bucket ${bucket.id} (private)`);
        else {
          const body = await res.text();
          // Re-running provisioning must not fail on buckets that already exist.
          if (/already exists/i.test(body)) ok(`bucket ${bucket.id} (already existed)`);
          else warn(`bucket ${bucket.id}: ${res.status} ${body.slice(0, 90)}`);
        }
      } catch (e) {
        warn(`bucket ${bucket.id}: ${(e instanceof Error ? e.message : String(e)).slice(0, 90)}`);
      }
    }
  }

  step('Setting edge function secrets');
  const secretNames = [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'SUMSUB_APP_TOKEN',
    'SUMSUB_SECRET_KEY',
    'RESEND_API_KEY',
    'ANTHROPIC_API_KEY',
  ];
  const secrets = secretNames
    .filter((n) => process.env[n])
    .map((n) => ({ name: n, value: process.env[n] }));
  if (secrets.length === 0) {
    warn('No third-party secrets in your environment — skipping.');
    warn(`Set them later:  supabase secrets set STRIPE_SECRET_KEY=... --project-ref ${ref}`);
  } else if (DRY) {
    ok(`[dry-run] would set: ${secrets.map((s) => s.name).join(', ')}`);
  } else {
    await api(`/projects/${ref}/secrets`, { method: 'POST', body: secrets });
    ok(`Set: ${secrets.map((s) => s.name).join(', ')}`);
  }

  // ── edge functions ───────────────────────────────────────────────────
  if (!SKIP_FUNCTIONS) {
    step('Deploying edge functions');
    const fnDir = join(ROOT, 'services', 'edge', 'functions');
    const fns = existsSync(fnDir)
      ? readdirSync(fnDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
      : [];
    ok(`${fns.length} functions found`);
    if (DRY) {
      fns.forEach((f) => console.log(c.dim(`      would deploy ${f}`)));
    } else {
      const cli = resolveSupabaseCli();
      if (!cli) {
        warn('Supabase CLI unavailable — skipping function deploy.');
        warn(`Deploy later:  npx supabase functions deploy --project-ref ${ref}`);
      } else {
        for (const f of fns) {
          const r = spawnSync(
            cli.cmd,
            [...cli.args, 'functions', 'deploy', f, '--project-ref', ref, '--no-verify-jwt'],
            { cwd: join(ROOT, 'services', 'edge'), stdio: 'pipe', encoding: 'utf8', env: { ...process.env, SUPABASE_ACCESS_TOKEN: TOKEN } },
          );
          if (r.status === 0) ok(`deployed ${f}`);
          else warn(`deploy ${f} failed: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-2).join(' ')}`);
        }
      }
    }
  }

  // ── env files ────────────────────────────────────────────────────────
  step('Writing .env.local files');
  const files = {
    'apps/admin/.env.local': [
      `VITE_SUPABASE_URL=${projectUrl}`,
      `VITE_SUPABASE_ANON_KEY=${anonKey}`,
      `VITE_EDGE_BASE_URL=${projectUrl}/functions/v1`,
      `VITE_DATA_SOURCE=supabase`,
      `# VITE_MAPBOX_TOKEN=pk.eyJ...   # add for live maps`,
      '',
    ].join('\n'),
    'apps/rider/.env.local': [
      `EXPO_PUBLIC_SUPABASE_URL=${projectUrl}`,
      `EXPO_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`,
      `EXPO_PUBLIC_EDGE_BASE_URL=${projectUrl}/functions/v1`,
      `EXPO_PUBLIC_DATA_SOURCE=supabase`,
      `# EXPO_PUBLIC_MAPBOX_TOKEN=pk.eyJ...`,
      `# EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...`,
      '',
    ].join('\n'),
    'apps/ops/.env.local': [
      `EXPO_PUBLIC_SUPABASE_URL=${projectUrl}`,
      `EXPO_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`,
      `EXPO_PUBLIC_EDGE_BASE_URL=${projectUrl}/functions/v1`,
      `EXPO_PUBLIC_DATA_SOURCE=supabase`,
      `# EXPO_PUBLIC_MAPBOX_TOKEN=pk.eyJ...`,
      '',
    ].join('\n'),
    '.env.provisioned': [
      `# Generated by scripts/provision-supabase.mjs — DO NOT COMMIT`,
      `SUPABASE_PROJECT_REF=${ref}`,
      `SUPABASE_URL=${projectUrl}`,
      `SUPABASE_ANON_KEY=${anonKey}`,
      `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`,
      `SUPABASE_DB_PASSWORD=${dbPassword}`,
      `# Gateway (VPS) connection string.`,
      `#`,
      `# Uses the POOLER in session mode. The direct host db.<ref>.supabase.co`,
      `# resolves to IPv6 ONLY on current Supabase projects, so an IPv4-only VPS`,
      `# cannot reach it. The pooler has A records and works on both stacks.`,
      `# Session mode (5432), not transaction mode (6543): the gateway holds`,
      `# long-lived connections and pgx uses prepared statements.`,
      `DB_URL=postgresql://postgres.${ref}:${dbPassword}@aws-0-${REGION}.pooler.supabase.com:5432/postgres`,
      `# Direct (IPv6 only, needs an IPv6-capable host):`,
      `# DB_URL=postgresql://postgres:${dbPassword}@db.${ref}.supabase.co:5432/postgres`,
      '',
    ].join('\n'),
  };
  for (const [rel, content] of Object.entries(files)) {
    const p = join(ROOT, rel);
    if (DRY) {
      console.log(c.dim(`      would write ${rel}`));
      continue;
    }
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
    ok(`wrote ${rel}`);
  }

  // ── summary ──────────────────────────────────────────────────────────
  console.log(`\n${c.g(c.b('Done.'))}\n`);
  console.log(`  Project ref   ${c.b(ref)}`);
  console.log(`  API URL       ${c.b(projectUrl)}`);
  console.log(`  Dashboard     https://supabase.com/dashboard/project/${ref}`);
  console.log(`  DB password   ${c.b(dbPassword)}  ${c.dim('(saved in .env.provisioned — store it safely)')}`);
  console.log(`
${c.b('Next (dashboard — cannot be automated):')}
  1. Auth → enable the ${c.b('Phone')} provider + an SMS sender (rider login is OTP)
  2. Stripe webhook  →  ${c.dim(`${projectUrl}/functions/v1/payments-webhook`)}
     Sumsub webhook  →  ${c.dim(`${projectUrl}/functions/v1/sumsub-webhook`)}

${c.b('Then:')}
  Gateway:    ${c.dim('DB_URL from .env.provisioned')}
  Panel live: ${c.dim('pnpm --filter @penny/admin dev')}
`);
}

function resolveSupabaseCli() {
  try {
    execFileSync('supabase', ['--version'], { stdio: 'ignore' });
    return { cmd: 'supabase', args: [] };
  } catch {
    /* not installed globally */
  }
  try {
    execFileSync('npx', ['--yes', 'supabase@latest', '--version'], { stdio: 'ignore', timeout: 120_000 });
    return { cmd: 'npx', args: ['--yes', 'supabase@latest'] };
  } catch {
    return null;
  }
}

main().catch((e) => die(e.stack || e.message));
