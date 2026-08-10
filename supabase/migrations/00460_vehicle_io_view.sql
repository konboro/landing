-- 00460_vehicle_io_view.sql
--
-- Live view of the digital lines (DIN1, DOUT1, DOUT2) for the admin panel's
-- IO monitor.
--
-- Why a view and not a straight read of `telemetry`: the normalized boolean
-- columns cannot tell "the line is low" from "the device never reported this
-- line", and on the current fleet that distinction is the whole story.
--
--   DIN1  (AVL id 239) — reported on every frame. Ignition.
--   DOUT2 (AVL id 180) — reported. Siren (docs/03, CONFIRMED by owner).
--   DOUT1 (AVL id 179) — NOT in the default IO set of this firmware profile
--                        (FMB930 fw 03.29.00). The device sends 180 and never
--                        179, yet `telemetry.dout1` still stores `false`, which
--                        renders as "relay off" — a measurement we never took.
--
-- So each line is exposed twice: the value, NULL unless the element was
-- actually present in the frame, and a `*_reported` flag taken from the raw
-- `io` jsonb. A panel that shows "—" for DOUT1 is telling the truth; one that
-- shows "OFF" is inventing it.
--
-- Consequence worth remembering (docs/03): with 179 absent, the "next AVL
-- record shows the expected DOUT state" ACK path cannot fire, so an unlock is
-- confirmed only by the Codec 12 reply. Enabling element 179 in Teltonika
-- Configurator -> I/O restores the second ACK source AND makes this view show a
-- real DOUT1 reading, with no code change.
--
-- Ordering/filtering matches the existing index on (vehicle_id, server_ts desc).

create or replace view v_vehicle_io as
select
  t.vehicle_id,
  t.device_id,
  t.device_ts,
  t.server_ts                          as at,
  -- Value only when the element was in the frame.
  case when t.io ? '239' then t.din1  end as din1,
  case when t.io ? '179' then t.dout1 end as dout1,
  case when t.io ? '180' then t.dout2 end as dout2,
  (t.io ? '239')                       as din1_reported,
  (t.io ? '179')                       as dout1_reported,
  (t.io ? '180')                       as dout2_reported,
  t.speed_kmh,
  t.ext_voltage_mv,
  t.batt_voltage_mv,
  t.gsm_signal,
  -- The raw element map, so the panel can show the frame behind a reading
  -- instead of asking someone to trust the parse.
  t.io
from telemetry t;

comment on view v_vehicle_io is
  'Digital lines per telemetry frame. Each of din1/dout1/dout2 is NULL unless its AVL element (239/179/180) was actually present — `*_reported` says which. Admin-only: read through the admin-list edge function.';

-- service_role only, like every other admin surface (Hard Rule #6). The panel
-- reaches it through `admin-list`, which checks staff permission first.
revoke all on v_vehicle_io from anon, authenticated;
