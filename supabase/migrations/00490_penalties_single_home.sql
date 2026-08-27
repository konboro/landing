-- 00490_penalties_single_home.sql
--
-- The penalty catalogue had two homes and neither worked.
--
-- docs/04 puts it in `app_config.penalties`, and there it is — but as an OBJECT
-- (`{bad_parking: [0,500,1000], …}`), while the reader in admin-panel-data does
-- `Array.isArray(value) ? value : []`. So the panel has always shown an empty
-- penalty catalogue no matter what was configured.
--
-- Migration 00470 then added a `penalties` TABLE and seeded it with amounts I
-- invented, which is worse than empty: an operator would have read fines off a
-- screen that no one had ever set. Notably it dropped the first-offence warning
-- tier (0 €) that docs/04 describes as the intended escalation.
--
-- This settles it on the table, because the panel models per-penalty facts a
-- single jsonb blob cannot carry — whether evidence is required, whether it can
-- be appealed, whether it is still offered — and because a table gives one
-- audit_log row per penalty changed instead of one for the whole catalogue.
-- docs/04 is updated in the same commit; this is a reconciliation, not a
-- silent pick.
--
-- The configured amounts win over my seed. Nothing charges from this catalogue
-- today (penalties go through `admin-charge` with a mandatory reason and an
-- explicit amount), so this changes what operators are shown, not what anyone
-- is billed.

-- 1. Drop the invented seed. Safe: 00470 shipped hours ago, nothing references
--    these rows, and no penalty has ever been charged from them.
delete from penalties
where code in ('bad_parking', 'outside_zone', 'no_photo', 'damage', 'blocked_access');

-- 2. Import what was actually configured. A scalar becomes a single tier.
insert into penalties (code, label, tiers_cents, requires_photo, appealable, active)
select
  e.key,
  initcap(replace(e.key, '_', ' ')),
  case jsonb_typeof(e.value)
    when 'array' then (select array_agg(v::int order by ord)
                       from jsonb_array_elements_text(e.value) with ordinality as t(v, ord))
    else array[e.value::text::int]
  end,
  true,   -- evidence before charging (docs/04: photo + reason pushed to the user)
  true,   -- every penalty is appealable → disputes
  true
from app_config c
cross join lateral jsonb_each(c.value) as e(key, value)
where c.key = 'penalties'
  and jsonb_typeof(c.value) = 'object'
on conflict (code) do nothing;

-- Readable labels for the imported codes; `initcap` alone gives "No Go".
update penalties set label = 'Riding into a no-go zone'        where code = 'no_go';
update penalties set label = 'Abandoned outside the zone'      where code = 'abandon';
update penalties set label = 'Bad parking'                     where code = 'bad_parking';

-- 3. One home. Leaving the key would keep a second, unreadable source of truth
--    that an operator could edit with no effect — the exact failure this
--    migration exists to remove. The values live on in `penalties` above.
delete from app_config where key = 'penalties';

comment on table penalties is
  'Penalty catalogue (docs/04). Advisory: charges are raised through admin-charge with an explicit amount and a mandatory reason, so editing a tier here does not re-bill anyone.';
