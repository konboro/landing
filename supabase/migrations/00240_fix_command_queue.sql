-- 00240_fix_command_queue.sql
--
-- FIX: the command bus was split in two and nothing joined it up.
--
--   * `enqueue_vehicle_command()` (migration 00150) pushed onto a pgmq queue
--     named `vehicle_commands`;
--   * the gateway reads `PGMQ_QUEUE`, whose default is `commands` — the name
--     given in docs/03 and .env.example.
--
-- So every unlock / lock / ring produced by the apps landed in a queue nobody
-- polls: commands would sit at `queued` forever and no scooter would ever
-- open. docs/03 is the source of truth (CLAUDE.md), so the queue is `commands`.
--
-- Also: the queue used to be created lazily inside an exception block on first
-- send. Create it up front so the very first unlock is not the thing that
-- discovers pgmq is missing.

do $$
begin
  perform pgmq.create('commands');
  raise notice 'pgmq queue "commands" ready';
exception
  when undefined_function or invalid_schema_name then
    raise notice 'pgmq unavailable (vanilla Postgres) — skipping queue creation';
  when others then
    -- Already exists is fine; anything else is worth seeing in the log.
    raise notice 'pgmq.create(commands): %', sqlerrm;
end
$$;

/* ---------------------------------------------------------------------------
   Re-point the enqueue helper at the documented queue.
   Signature and behaviour are otherwise unchanged: still best-effort, so a
   missing pgmq degrades to "command row written, delivery pending" rather than
   failing the trip.
   --------------------------------------------------------------------------- */
create or replace function enqueue_vehicle_command(p_command_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pgmq.send('commands', jsonb_build_object('command_id', p_command_id));
exception
  when undefined_function or invalid_schema_name then
    raise notice 'pgmq unavailable — command % left queued for the gateway to pick up', p_command_id;
  when others then
    raise notice 'pgmq.send skipped for command % : %', p_command_id, sqlerrm;
end
$$;

comment on function enqueue_vehicle_command(uuid) is
  'Enqueue a commands row onto the pgmq queue "commands" (docs/03, PGMQ_QUEUE default). The gateway consumes it and delivers over Codec 12.';

revoke all on function enqueue_vehicle_command(uuid) from public, anon, authenticated;
grant execute on function enqueue_vehicle_command(uuid) to service_role;

/* ---------------------------------------------------------------------------
   Drain anything already stranded on the old queue, then drop it so the split
   cannot silently come back.
   --------------------------------------------------------------------------- */
do $$
declare
  moved int := 0;
  rec record;
begin
  for rec in
    select msg_id, message from pgmq.read('vehicle_commands', 5, 1000)
  loop
    perform pgmq.send('commands', rec.message);
    perform pgmq.delete('vehicle_commands', rec.msg_id);
    moved := moved + 1;
  end loop;
  if moved > 0 then
    raise notice 'moved % stranded command(s) from vehicle_commands to commands', moved;
  end if;
  perform pgmq.drop_queue('vehicle_commands');
exception
  when others then
    raise notice 'no legacy vehicle_commands queue to migrate (%).', sqlerrm;
end
$$;
