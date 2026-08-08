-- 00150_functions.sql
-- Ledger poster, atomic trip transition, derived wallet balance.

-- post_ledger: insert a set of balanced legs under one txn id.
-- entries := jsonb array of { account_id, delta_cents, currency?, memo? }.
-- Raises immediately if the legs do not net to zero (Hard Rule #2); the deferred
-- constraint trigger in 00080 is the backstop at COMMIT.
create or replace function post_ledger(txn uuid, entries jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  total bigint := 0;
  leg   jsonb;
begin
  if jsonb_typeof(entries) <> 'array' or jsonb_array_length(entries) < 2 then
    raise exception 'post_ledger: entries must be a jsonb array of >= 2 legs';
  end if;

  for leg in select * from jsonb_array_elements(entries) loop
    total := total + (leg->>'delta_cents')::bigint;
  end loop;

  if total <> 0 then
    raise exception
      'post_ledger: unbalanced txn % (sum=% cents). Hard Rule #2: double-entry must net to zero.',
      txn, total;
  end if;

  insert into ledger_entries (txn_id, account_id, delta_cents, currency, memo)
  select
    txn,
    (leg->>'account_id')::uuid,
    (leg->>'delta_cents')::bigint,
    coalesce(leg->>'currency', 'EUR'),
    leg->>'memo'
  from jsonb_array_elements(entries) as leg;

  return txn;
end $$;

-- trip_transition: append a trip_events row (from = current cached status) and move
-- trips.status forward atomically (Hard Rule #4: trips.status is a cache of last event).
create or replace function trip_transition(
  trip   uuid,
  to_st  trip_status,
  actor  trip_actor,
  meta   jsonb default '{}'::jsonb
)
returns trip_status
language plpgsql
security definer
set search_path = public
as $$
declare
  from_st trip_status;
begin
  select status into from_st from trips where id = trip for update;
  if not found then
    raise exception 'trip_transition: trip % not found', trip;
  end if;

  insert into trip_events (trip_id, from_status, to_status, actor, meta)
  values (trip, from_st, to_st, actor, coalesce(meta, '{}'::jsonb));

  update trips set status = to_st where id = trip;
  return to_st;
end $$;

-- Derived per-user wallet balance (never a stored column — Hard Rule #2).
-- Sign convention: user_wallet is a LIABILITY (we hold the rider's prepaid funds).
-- A top-up credits it (delta -X); a spend debits it (delta +X). Available funds the
-- rider can spend are therefore the NEGATED sum, so balance_cents reads positive.
create or replace view v_user_wallet_balance as
select
  a.owner_id                                as user_id,
  (-coalesce(sum(e.delta_cents), 0))::bigint as balance_cents,
  a.currency
from ledger_accounts a
left join ledger_entries e on e.account_id = a.id
where a.kind = 'user_wallet' and a.owner_id is not null
group by a.owner_id, a.currency;

-- Authoritative geofence lookup (Hard Rule #3): which active zones contain a point.
create or replace function zones_at_point(p_lng float8, p_lat float8, p_city uuid default null)
returns table (id uuid, kind zone_kind, rules jsonb)
language sql stable security definer set search_path = public as $$
  select z.id, z.kind, z.rules
  from zones z
  where z.active
    and (p_city is null or z.city_id = p_city)
    and st_contains(z.geom, st_setsrid(st_makepoint(p_lng, p_lat), 4326));
$$;

-- One-shot snapshot for trip-start / command preconditions (lng/lat as plain floats).
create or replace function vehicle_snapshot(p_code text)
returns table (
  vehicle_id uuid, code text, status vehicle_status, visible boolean, city_id uuid,
  model_id uuid, kind vehicle_kind, requires_licence boolean, max_speed_kmh int,
  device_id uuid, soc_pct smallint, session_online boolean, last_seen timestamptz,
  lng float8, lat float8, locked boolean
)
language sql stable security definer set search_path = public as $$
  select v.id, v.code, v.status, v.visible, v.city_id,
         m.id, m.kind, m.requires_licence, m.max_speed_kmh,
         d.id, vs.soc_pct, vs.session_online, vs.last_seen,
         st_x(vs.pos), st_y(vs.pos), vs.locked
  from vehicles v
  join vehicle_models m on m.id = v.model_id
  left join vehicle_state vs on vs.vehicle_id = v.id
  left join devices d on d.vehicle_id = v.id and d.status = 'active'
  where v.code = p_code
  limit 1;
$$;

-- Apply a new zone version: supersede the city's active zones and insert the new set
-- from GeoJSON. Never mutates prior geometry — old rows are just deactivated; the full
-- snapshot is kept in zone_versions (docs/02: admin editor writes a new version).
create or replace function apply_zone_version(p_city uuid, p_zones jsonb, p_reason text, p_by uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v int;
  z jsonb;
begin
  select greatest(
    coalesce((select max(version) from zones where city_id = p_city), 0),
    coalesce((select max(version) from zone_versions where city_id = p_city), 0)
  ) + 1 into v;

  update zones set active = false where city_id = p_city and active;

  for z in select * from jsonb_array_elements(p_zones) loop
    insert into zones (city_id, kind, name, geom, rules, active, version, created_by)
    values (
      p_city,
      (z->>'kind')::zone_kind,
      z->>'name',
      st_setsrid(st_geomfromgeojson(z->'geom'), 4326),
      coalesce(z->'rules', '{}'::jsonb),
      true, v, p_by
    );
  end loop;

  insert into zone_versions (city_id, version, payload, reason, created_by)
  values (p_city, v, p_zones, p_reason, p_by);

  return v;
end $$;

-- Best-effort command enqueue. pgmq is Supabase-managed; when absent (dev) the
-- gateway also polls commands.status='queued' directly, so this never blocks a trip.
create or replace function enqueue_vehicle_command(p_command_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform pgmq.create('vehicle_commands');
  exception when others then null;  -- already exists / pgmq unavailable
  end;
  begin
    perform pgmq.send('vehicle_commands', jsonb_build_object('command_id', p_command_id));
  exception when others then
    raise notice 'pgmq.send skipped for command % : %', p_command_id, sqlerrm;
  end;
end $$;

-- Rider-facing wallet balance: same derivation, self-scoped. The view is
-- security-definer (reads ledger past its RLS) and filters to the caller, so a
-- rider only ever sees their own balance. v_user_wallet_balance stays service_role-only.
create or replace view v_my_wallet_balance as
select user_id, balance_cents, currency
from v_user_wallet_balance
where user_id = auth.uid();

grant select on public.v_my_wallet_balance to authenticated;
