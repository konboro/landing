// admin-write — create / update / delete on the panel's CONFIGURATION tables.
//
// The mirror image of `admin-list`: one function, one whitelist, permission
// checked per table, and every change written to `audit_log` (Hard Rule #8).
// Hard Rule #6 stands — the panel never writes to these tables with the anon
// key; they are service_role-only and reached only through here.
//
// Deliberately NOT for business state. Vehicles, zones, money, statuses and
// broadcasts each have their own function because each has rules beyond "set
// these columns" (transition matrices, ledger entries, consent filtering, ACK
// requirements). This one is for catalogues an operator edits: prices,
// packages, promo codes, FAQ entries, penalty tiers.
//
// The column allowlist is the security boundary. Without it, `patch` would be
// a free-form UPDATE and a caller could set `id`, timestamps, or a column the
// UI never shows.

import { handlePreflight } from '../../_shared/cors.ts';
import { json, withErrors, EdgeError } from '../../_shared/responses.ts';
import { adminClient, requireUser, requireStaff } from '../../_shared/admin.ts';
import { readJson, str } from '../../_shared/validate.ts';
import { writeAudit } from '../../_shared/audit.ts';

interface TableSpec {
  /** Permission the caller must hold to touch this table. */
  permission: string;
  /** Columns a caller may set on insert or update. Everything else is dropped. */
  columns: string[];
  /** Primary key columns. Defaults to a single `id`; `app_content` is keyed by
   *  (key, lang), so a row cannot always be addressed by one value. */
  pk?: string[];
  /** Delete allowed at all? Catalogues referenced by historical rows are
   *  deactivated instead, so the history keeps resolving. */
  deletable: boolean;
  /** Column flipped instead of deleting, when `deletable` is false. */
  softDeleteColumn?: string;
  /** Human label for the audit entry. */
  entity: string;
}

const TABLES: Record<string, TableSpec> = {
  /* ---- Pricing ---- */
  pricing_plans: {
    permission: 'pricing.edit',
    columns: ['city_id', 'model_id', 'unlock_cents', 'per_min_cents', 'pause_per_min_cents', 'day_cap_cents', 'valid_from', 'valid_to', 'dynamic'],
    deletable: true,
    entity: 'pricing_plan',
  },
  packages: {
    permission: 'pricing.edit',
    columns: ['name', 'minutes', 'price_cents', 'validity_days', 'active'],
    // A package someone bought must keep resolving on their receipt.
    deletable: false, softDeleteColumn: 'active',
    entity: 'package',
  },
  subscriptions: {
    permission: 'pricing.edit',
    columns: ['name', 'stripe_price_id', 'perks', 'active'],
    deletable: false, softDeleteColumn: 'active',
    entity: 'subscription',
  },
  addons: {
    permission: 'pricing.edit',
    columns: ['name', 'kind', 'price_cents', 'per', 'active'],
    deletable: false, softDeleteColumn: 'active',
    entity: 'addon',
  },
  penalties: {
    permission: 'pricing.edit',
    columns: ['code', 'label', 'tiers_cents', 'requires_photo', 'appealable', 'active'],
    // A charged penalty references this row by code in disputes and appeals.
    deletable: false, softDeleteColumn: 'active',
    entity: 'penalty',
  },

  /* ---- Marketing ---- */
  promo_codes: {
    permission: 'settings.edit',
    // `kind` is percent | fixed | free_minutes and `value` is read in that
    // kind's unit (percent points, cents, minutes) — docs/02. One column, not
    // three mutually exclusive ones.
    columns: ['code', 'kind', 'value', 'max_uses', 'per_user_limit', 'valid_from', 'valid_to', 'new_users_only', 'city_id', 'active'],
    // A redeemed code is referenced by the discount on someone's receipt.
    deletable: false, softDeleteColumn: 'active',
    entity: 'promo_code',
  },
  customer_groups: {
    permission: 'settings.edit',
    columns: ['name', 'rules'],
    deletable: true,
    entity: 'customer_group',
  },
  loyalty_tiers: {
    permission: 'settings.edit',
    columns: ['name', 'min_points', 'perks', 'active'],
    deletable: true,
    entity: 'loyalty_tier',
  },
  pois: {
    permission: 'settings.edit',
    columns: ['city_id', 'kind', 'name', 'pos', 'icon', 'active'],
    deletable: true,
    entity: 'poi',
  },

  /* ---- Content ---- */
  faq_items: {
    permission: 'settings.edit',
    columns: ['lang', 'question', 'answer', 'sort', 'active'],
    deletable: true,
    entity: 'faq_item',
  },
  app_content: {
    permission: 'settings.edit',
    columns: ['key', 'lang', 'value'],
    // Keyed by (key, lang) — there is no id column. One entry per language of
    // the same content key, which is the whole point of the table.
    pk: ['key', 'lang'],
    deletable: true,
    entity: 'app_content',
  },

  // Which events page whom, on which channel, how often. Editable because the
  // right throttle for a low-battery alert is something operations learns by
  // running the fleet, not something that belongs in a migration.
  notification_rules: {
    permission: 'settings.edit',
    columns: ['event_kind', 'condition', 'channels', 'recipients', 'throttle_s', 'digest', 'quiet_hours', 'active'],
    deletable: false, softDeleteColumn: 'active',
    entity: 'notification_rule',
  },
  translations: {
    permission: 'settings.edit',
    columns: ['lang', 'ns', 'key', 'value'],
    // Keyed by (lang, ns, key) — the same string in three languages is three
    // rows, which is the whole shape of a translation table.
    pk: ['lang', 'ns', 'key'],
    deletable: true,
    entity: 'translation',
  },

  /* ---- Team ---- */
  corporate_accounts: {
    permission: 'team.manage',
    columns: ['name', 'billing_email', 'stripe_customer_id', 'monthly_invoicing', 'active'],
    // Invoices issued to a company must keep resolving — and under Greek
    // myDATA rules they are retained regardless (docs/05).
    deletable: false, softDeleteColumn: 'active',
    entity: 'corporate_account',
  },
  staff: {
    // Changing who can do what is its own blast radius.
    permission: 'team.manage',
    columns: ['user_id', 'role', 'city_scope', 'active'],
    deletable: false, softDeleteColumn: 'active',
    entity: 'staff',
  },
};

/** Keep only the columns the spec allows; silently dropping the rest is the
 *  point — a stray `id` or `created_at` from a form must never reach the DB. */
function pick(values: Record<string, unknown>, allowed: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of allowed) if (k in values && values[k] !== undefined) out[k] = values[k];
  return out;
}

const handler = withErrors(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = adminClient();
  const callerId = await requireUser(req, admin);

  const body = await readJson(req);
  const table = str(body, 'table')!;
  const action = str(body, 'action')!;
  const spec = TABLES[table];
  if (!spec) throw new EdgeError('bad_request', `table not writable here: ${table}`, 400);
  if (!['create', 'update', 'delete'].includes(action)) {
    throw new EdgeError('bad_request', `unknown action: ${action}`, 400);
  }

  const staff = await requireStaff(admin, callerId, spec.permission);
  const reason = str(body, 'reason', false) ?? null;
  const values = (body.values ?? {}) as Record<string, unknown>;
  const id = str(body, 'id', false);

  if (action === 'create') {
    const row = pick(values, spec.columns);
    if (Object.keys(row).length === 0) throw new EdgeError('bad_request', 'nothing to insert', 400);
    const { data, error } = await admin.from(table).insert(row).select('*').single();
    if (error) throw new EdgeError('db_error', error.message, 400);
    await writeAudit(admin, {
      staff_id: staff.staff_id, action: `${spec.entity}.create`, entity: table,
      entity_id: String((data as { id?: string }).id ?? ''), before: null, after: row,
      reason, ip: req.headers.get('x-forwarded-for'),
    });
    return json({ row: data }, 201);
  }

  // Which row? Single-key tables take `id`; composite ones take `key` as an
  // object of the key columns. Built here once so update and delete address a
  // row identically.
  const pkCols = spec.pk ?? ['id'];
  const match: Record<string, unknown> = {};
  if (pkCols.length === 1 && pkCols[0] === 'id') {
    if (!id) throw new EdgeError('bad_request', 'id is required', 400);
    match.id = id;
  } else {
    const key = (body.key ?? {}) as Record<string, unknown>;
    for (const c of pkCols) {
      if (key[c] === undefined || key[c] === null || key[c] === '') {
        throw new EdgeError('bad_request', `key.${c} is required for ${table}`, 400);
      }
      match[c] = key[c];
    }
  }
  const entityId = pkCols.map((c) => String(match[c])).join('/');

  // Read the before-image first: an audit entry that cannot say what changed is
  // barely an audit entry.
  const { data: before } = await admin.from(table).select('*').match(match).maybeSingle();
  if (!before) throw new EdgeError('not_found', `${spec.entity} not found`, 404);

  if (action === 'update') {
    const patch = pick(values, spec.columns);
    if (Object.keys(patch).length === 0) throw new EdgeError('bad_request', 'nothing to update', 400);
    const { data, error } = await admin.from(table).update(patch).match(match).select('*').single();
    if (error) throw new EdgeError('db_error', error.message, 400);
    await writeAudit(admin, {
      staff_id: staff.staff_id, action: `${spec.entity}.update`, entity: table, entity_id: entityId,
      before, after: patch, reason, ip: req.headers.get('x-forwarded-for'),
    });
    return json({ row: data });
  }

  // delete
  if (!spec.deletable) {
    const col = spec.softDeleteColumn ?? 'active';
    const { data, error } = await admin.from(table).update({ [col]: false }).match(match).select('*').single();
    if (error) throw new EdgeError('db_error', error.message, 400);
    await writeAudit(admin, {
      staff_id: staff.staff_id, action: `${spec.entity}.deactivate`, entity: table, entity_id: entityId,
      before, after: { [col]: false }, reason, ip: req.headers.get('x-forwarded-for'),
    });
    // Told plainly so the UI can say "deactivated", not "deleted" — the row is
    // still referenced by receipts, disputes and history.
    return json({ row: data, deactivated: true });
  }

  const { error } = await admin.from(table).delete().match(match);
  if (error) throw new EdgeError('db_error', error.message, 400);
  await writeAudit(admin, {
    staff_id: staff.staff_id, action: `${spec.entity}.delete`, entity: table, entity_id: entityId,
    before, after: null, reason, ip: req.headers.get('x-forwarded-for'),
  });
  return json({ deleted: true });
});

Deno.serve(handler);
