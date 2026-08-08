-- 00190_seed_profiles_history.sql
-- Demo-ready seed for the Customer detail / Vehicle detail screens (docs/08).
-- Extends 00160_seed.sql (Athens, 1 model, 6 vehicles, zones, pricing, staff owner) with:
--   * 12 enriched rider profiles (Greek/Polish, Athens addresses, varied KYC & risk)
--   * sumsub_applicants / _documents / _review_history covering every review state
--   * ~170 trips over the last 90 days with events, routes, reviews, commands,
--     payments and BALANCED ledger entries (Hard Rule #2)
--   * fleet history: telemetry, alerts, status log, damage, battery swaps, maintenance
--
-- Determinism: no random(). Every "random" value comes from _seed_rnd(key), an md5-based
-- PRNG, and every primary key is md5('penny-seed-...')::uuid — so re-running this file is
-- a no-op (on conflict do nothing) and two machines produce byte-identical data.
--
-- Hard Rule #2: ledger legs are always inserted as a single UNION ALL statement so the
-- deferred balance trigger sees a complete, zero-summing txn.
-- Hard Rule #11: all document data here is synthetic. storage_path points at the private
-- kyc-docs bucket; no real bytes are written.

-- ---------------------------------------------------------------------------
-- Deterministic PRNG helper (dropped at the end of this file).
-- ---------------------------------------------------------------------------
create or replace function _seed_rnd(k text) returns double precision
language sql immutable as $$
  select ((('x' || substr(md5(k), 1, 8))::bit(32)::bigint & 2147483647)::double precision)
         / 2147483647.0;
$$;

-- ===========================================================================
-- 1. Customer groups & corporate account
-- ===========================================================================

insert into customer_groups (id, name, rules) values
  (md5('penny-seed-cg:commuters')::uuid, 'Commuters',
     '{"min_rides_30d":8,"city":"Athens"}'::jsonb),
  (md5('penny-seed-cg:students')::uuid,  'Students',
     '{"age_max":26}'::jsonb),
  (md5('penny-seed-cg:corporate')::uuid, 'Corporate',
     '{"has_corporate_account":true}'::jsonb),
  (md5('penny-seed-cg:watchlist')::uuid, 'Watchlist',
     '{"min_risk_score":60}'::jsonb)
on conflict (id) do nothing;

insert into corporate_accounts (id, name, billing_email, stripe_customer_id, monthly_invoicing)
values (md5('penny-seed-corp:aegean')::uuid, 'Aegean Digital AE',
        'ap@aegeandigital.example.gr', null, true)
on conflict (id) do nothing;

-- ===========================================================================
-- 2. Twelve demo riders
-- ===========================================================================

-- auth.users mirror first (FK target on both Supabase and the vanilla-PG shim).
do $$
declare r record;
begin
  for r in
    select * from (values
      ('000000d0-0000-0000-0000-000000000001'::uuid, '+306941000001', 'nikos.papadopoulos@example.gr'),
      ('000000d0-0000-0000-0000-000000000002'::uuid, '+306941000002', 'maria.georgiou@example.gr'),
      ('000000d0-0000-0000-0000-000000000003'::uuid, '+306941000003', 'katarzyna.nowak@example.pl'),
      ('000000d0-0000-0000-0000-000000000004'::uuid, '+306941000004', 'dimitris.antoniou@example.gr'),
      ('000000d0-0000-0000-0000-000000000005'::uuid, '+306941000005', 'piotr.kowalski@example.pl'),
      ('000000d0-0000-0000-0000-000000000006'::uuid, '+306941000006', 'eleni.vasiliou@example.gr'),
      ('000000d0-0000-0000-0000-000000000007'::uuid, '+306941000007', 'giorgos.ioannou@example.gr'),
      ('000000d0-0000-0000-0000-000000000008'::uuid, '+306941000008', 'anna.wisniewska@example.pl'),
      ('000000d0-0000-0000-0000-000000000009'::uuid, '+306941000009', 'sofia.papandreou@example.gr'),
      ('000000d0-0000-0000-0000-000000000010'::uuid, '+306941000010', 'marek.lewandowski@example.pl'),
      ('000000d0-0000-0000-0000-000000000011'::uuid, '+306941000011', 'christos.makris@example.gr'),
      ('000000d0-0000-0000-0000-000000000012'::uuid, '+306941000012', 'ioanna.dimitriou@example.gr')
    ) as t(id, phone, email)
  loop
    begin
      insert into auth.users (id, email) values (r.id, r.email) on conflict (id) do nothing;
    exception when others then
      null;  -- vanilla Postgres without the shim, or restricted auth.users columns
    end;
  end loop;
end $$;

do $$
begin
  insert into users (
    id, phone, email, full_name, legacy_atom_user_id, sumsub_applicant_id, kyc_status,
    customer_group_id, status, blocked_reason, marketing_consent, tos_accepted_at,
    privacy_accepted_at, score, emergency_contact, date_of_birth, nationality, gender,
    address_line, address_city, address_postcode, address_country, avatar_url,
    preferred_lang, email_verified, phone_verified, signup_source, signup_city_id,
    last_active_at, risk_score, tags, internal_notes, created_at, updated_at
  )
  select
    d.id, d.phone, d.email, d.full_name, d.legacy_id, d.applicant, d.kyc::kyc_status,
    (select id from customer_groups where name = d.grp),
    d.st::user_status, d.blocked_reason, d.marketing, now() - (d.age_days || ' days')::interval,
    now() - (d.age_days || ' days')::interval, d.score, d.emergency, d.dob::date, d.nat, d.gender,
    d.addr, 'Athens', d.postcode, 'GR',
    'https://cdn.penny.rent/demo/avatars/' || right(d.id::text, 2) || '.png',
    d.lang, d.email_ok, true, d.source,
    (select id from cities where name = 'Athens'),
    now() - (d.active_h || ' hours')::interval, d.risk, d.tags::text[], d.notes,
    now() - (d.age_days || ' days')::interval, now()
  from (values
    ('000000d0-0000-0000-0000-000000000001'::uuid, '+306941000001', 'nikos.papadopoulos@example.gr',
      'Nikos Papadopoulos', null, 'app-nik-0001', 'approved', 'Commuters', 'active', null, true,
      410, 118, 'Eleni Papadopoulou +306940000101', '1991-03-14', 'GR', 'male',
      'Ermou 12', '10563', 'el', true, 'ios', 3, 0,
      '{early_adopter,commuter}', 'Pilot cohort tester. Very active on weekday mornings.'),
    ('000000d0-0000-0000-0000-000000000002'::uuid, '+306941000002', 'maria.georgiou@example.gr',
      'Maria Georgiou', null, 'app-mar-0002', 'approved', 'Commuters', 'active', null, true,
      380, 112, 'Kostas Georgiou +306940000102', '1988-07-02', 'GR', 'female',
      'Patission 45', '10433', 'el', true, 'android', 11, 0,
      '{commuter}', null),
    ('000000d0-0000-0000-0000-000000000003'::uuid, '+306941000003', 'katarzyna.nowak@example.pl',
      'Katarzyna Nowak', null, 'app-kat-0003', 'approved', 'Students', 'active', null, false,
      300, 104, null, '1995-11-23', 'PL', 'female',
      'Kifisias 88', '11526', 'pl', true, 'ios', 26, 5,
      '{expat,student}', 'Erasmus student, UI language PL.'),
    ('000000d0-0000-0000-0000-000000000004'::uuid, '+306941000004', 'dimitris.antoniou@example.gr',
      'Dimitris Antoniou', null, 'app-dim-0004', 'rejected', 'Watchlist', 'blocked',
      'KYC rejected FINAL — document forgery (Sumsub label FORGERY)', false,
      210, 40, null, '1999-01-30', 'GR', 'male',
      'Akadimias 7', '10671', 'el', false, 'android', 480, 85,
      '{fraud_review,kyc_forgery}', 'Submitted a tampered ID. Do not re-open without manager sign-off.'),
    ('000000d0-0000-0000-0000-000000000005'::uuid, '+306941000005', 'piotr.kowalski@example.pl',
      'Piotr Kowalski', null, 'app-pio-0005', 'pending', null, 'active', null, true,
      95, 88, 'Agata Kowalska +48601000105', '1993-05-18', 'PL', 'male',
      'Solonos 22', '10672', 'pl', true, 'ios', 30, 20,
      '{retry_kyc}', 'RED/RETRY: blurry passport photo, asked to re-submit.'),
    ('000000d0-0000-0000-0000-000000000006'::uuid, '+306941000006', 'eleni.vasiliou@example.gr',
      'Eleni Vasiliou', null, 'app-ele-0006', 'pending', 'Students', 'active', null, true,
      40, 100, null, '2001-09-09', 'GR', 'female',
      'Vouliagmenis 210', '17237', 'el', true, 'ios', 6, 0,
      '{new}', 'Signed up this month, KYC still in the Sumsub queue.'),
    ('000000d0-0000-0000-0000-000000000007'::uuid, '+306941000007', 'giorgos.ioannou@example.gr',
      'Giorgos Ioannou', 'atom-88213', 'app-gio-0007', 'pending', null, 'active', null, false,
      160, 92, null, '1985-12-01', 'GR', 'male',
      'Alexandras 130', '11471', 'el', true, 'web', 72, 35,
      '{manual_review}', 'On hold at Sumsub: name mismatch vs. the phone contract. Support to call.'),
    ('000000d0-0000-0000-0000-000000000008'::uuid, '+306941000008', 'anna.wisniewska@example.pl',
      'Anna Wiśniewska', null, 'app-ann-0008', 'approved', 'Corporate', 'active', null, false,
      270, 108, 'Jan Wiśniewski +48601000108', '1990-04-27', 'PL', 'female',
      'Syngrou 154', '17671', 'pl', true, 'android', 14, 0,
      '{corporate}', 'Billed to Aegean Digital AE (monthly invoicing).'),
    ('000000d0-0000-0000-0000-000000000009'::uuid, '+306941000009', 'sofia.papandreou@example.gr',
      'Sofia Papandreou', null, 'app-sof-0009', 'approved', 'Commuters', 'active', null, true,
      350, 120, 'Alexis Papandreou +306940000109', '1997-08-15', 'GR', 'female',
      'Mesogeion 300', '15562', 'el', true, 'ios', 2, 0,
      '{loyalty_gold,commuter}', 'Highest ride count in the pilot. Loyalty gold tier.'),
    ('000000d0-0000-0000-0000-000000000010'::uuid, '+306941000010', 'marek.lewandowski@example.pl',
      'Marek Lewandowski', null, null, 'none', null, 'active', null, false,
      25, 100, null, '1992-02-11', 'PL', 'male',
      'Ippokratous 55', '10680', 'pl', false, 'web', 500, 0,
      '{no_kyc}', 'Registered but never completed KYC — cannot unlock (docs/09 re-KYC path).'),
    ('000000d0-0000-0000-0000-000000000011'::uuid, '+306941000011', 'christos.makris@example.gr',
      'Christos Makris', 'atom-41077', 'app-chr-0011', 'approved', 'Watchlist', 'blocked',
      'chargeback under review', false,
      430, 55, null, '1986-06-06', 'GR', 'male',
      'Panepistimiou 40', '10679', 'el', true, 'migration_atom', 240, 95,
      '{chargeback,migrated_atom}', 'Migrated from Atom. Chargeback filed on a 14.20 EUR trip; ledger debt open.'),
    ('000000d0-0000-0000-0000-000000000012'::uuid, '+306941000012', 'ioanna.dimitriou@example.gr',
      'Ioanna Dimitriou', 'atom-52940', 'app-ioa-0012', 'expired', null, 'active', null, true,
      460, 98, null, '1994-10-19', 'GR', 'female',
      'Stadiou 18', '10564', 'el', true, 'migration_atom', 96, 10,
      '{expired_doc,migrated_atom}', 'Migrated from Atom. ID expired — force re-KYC before next unlock.')
  ) as d(id, phone, email, full_name, legacy_id, applicant, kyc, grp, st, blocked_reason,
         marketing, age_days, score, emergency, dob, nat, gender, addr, postcode, lang,
         email_ok, source, active_h, risk, tags, notes)
  on conflict (id) do nothing;
exception when foreign_key_violation then
  raise notice 'Demo rider seed skipped: matching auth.users rows are required on Supabase (%).', sqlerrm;
end $$;

-- Corporate membership for Anna Wiśniewska.
insert into corporate_members (id, corporate_id, user_id, monthly_limit_cents)
select md5('penny-seed-cm:anna')::uuid, md5('penny-seed-corp:aegean')::uuid,
       '000000d0-0000-0000-0000-000000000008'::uuid, 15000
where exists (select 1 from users where id = '000000d0-0000-0000-0000-000000000008')
on conflict (id) do nothing;

-- Notification prefs + a saved card for every demo rider (Customers table shows card on file).
insert into user_notification_prefs (user_id, push_marketing, email_marketing, lang)
select u.id, u.marketing_consent, u.marketing_consent,
       (case when u.preferred_lang in ('pl', 'en', 'el') then u.preferred_lang else 'el' end)::lang
from users u
where u.id::text like '000000d0-0000-0000-0000-%'
on conflict (user_id) do nothing;

insert into payment_methods (id, user_id, stripe_pm_id, brand, last4, exp, status, is_default, created_at)
select
  md5('penny-seed-pm:' || u.id::text)::uuid,
  u.id,
  'pm_demo_' || right(u.id::text, 12),
  -- floor(), not ::int — a cast to int ROUNDS and would overflow the array bound
  (array['visa', 'mastercard', 'visa', 'amex'])[1 + floor(_seed_rnd('brand:' || u.id::text) * 4)::int],
  lpad(((_seed_rnd('last4:' || u.id::text) * 9000)::int + 1000)::text, 4, '0'),
  '0' || (1 + (_seed_rnd('expm:' || u.id::text) * 8)::int)::text || '/2029',
  'active', true, u.created_at
from users u
where u.id::text like '000000d0-0000-0000-0000-%'
  and u.kyc_status <> 'none'                       -- the no-KYC rider never added a card
on conflict (id) do nothing;

-- ===========================================================================
-- 3. Sumsub cache — every interesting review state (Hard Rule #11: synthetic data)
-- ===========================================================================

insert into sumsub_applicants (
  id, user_id, applicant_id, external_user_id, level_name, inspection_id,
  review_status, review_answer, review_reject_type, reject_labels,
  moderation_comment, client_comment,
  first_name, last_name, middle_name, dob, nationality, country, place_of_birth, gender,
  id_doc_type, id_doc_number, id_doc_expiry, id_doc_country, phone, email,
  applicant_created_at, reviewed_at, raw, synced_at, created_at, updated_at
)
select
  md5('penny-seed-sa:' || a.applicant)::uuid,
  a.uid,
  a.applicant,
  a.uid::text,
  a.level,
  'insp_' || substr(md5(a.applicant), 1, 16),
  a.rstatus, a.ranswer, a.rtype, a.labels::text[],
  a.mod_comment, a.client_comment,
  a.first_name, a.last_name, null, a.dob::date, a.nat, a.nat, a.pob, a.gender,
  a.doc_type, a.doc_no, a.doc_exp::date, a.nat, u.phone, u.email,
  now() - (a.created_days || ' days')::interval,
  case when a.rstatus = 'completed' then now() - (a.reviewed_days || ' days')::interval end,
  jsonb_build_object(
    'id', a.applicant,
    'externalUserId', a.uid::text,
    'inspectionId', 'insp_' || substr(md5(a.applicant), 1, 16),
    'review', jsonb_build_object(
      'reviewStatus', a.rstatus,
      'reviewResult', jsonb_build_object(
        'reviewAnswer', a.ranswer,
        'reviewRejectType', a.rtype,
        'rejectLabels', to_jsonb(a.labels::text[]),
        'moderationComment', a.mod_comment
      )
    ),
    'info', jsonb_build_object(
      'firstName', a.first_name, 'lastName', a.last_name, 'dob', a.dob,
      'nationality', a.nat, 'placeOfBirth', a.pob, 'gender', a.gender
    ),
    '_note', 'synthetic seed payload — no real applicant data (Hard Rule #11)'
  ),
  now() - (a.synced_h || ' hours')::interval,
  now() - (a.created_days || ' days')::interval,
  now()
from (values
  -- GREEN / approved
  ('000000d0-0000-0000-0000-000000000001'::uuid, 'app-nik-0001', 'id-and-liveness',
    'completed', 'GREEN', null, '{}', null, 'Auto-approved, all checks green.',
    'Nikos', 'Papadopoulos', '1991-03-14', 'GR', 'Athens', 'male',
    'ID_CARD', 'AK4471928', '2031-03-13', 405, 404, 6),
  ('000000d0-0000-0000-0000-000000000002'::uuid, 'app-mar-0002', 'id-and-liveness',
    'completed', 'GREEN', null, '{}', null, null,
    'Maria', 'Georgiou', '1988-07-02', 'GR', 'Thessaloniki', 'female',
    'PASSPORT', 'AM8823410', '2030-06-21', 378, 377, 12),
  ('000000d0-0000-0000-0000-000000000003'::uuid, 'app-kat-0003', 'id-and-liveness',
    'completed', 'GREEN', null, '{}', null, 'PL driving licence accepted as primary document.',
    'Katarzyna', 'Nowak', '1995-11-23', 'PL', 'Kraków', 'female',
    'DRIVERS', 'CBA903117', '2032-01-09', 297, 296, 20),
  -- RED / FINAL — forgery
  ('000000d0-0000-0000-0000-000000000004'::uuid, 'app-dim-0004', 'id-and-liveness',
    'completed', 'RED', 'FINAL', '{FORGERY}',
    'The document you provided appears to have been altered. Your application was declined.',
    'Photoshop artefacts on the MRZ line. Escalated to fraud. Permanent decline.',
    'Dimitris', 'Antoniou', '1999-01-30', 'GR', 'Piraeus', 'male',
    'ID_CARD', 'AB1029384', '2029-11-02', 208, 205, 30),
  -- RED / RETRY — bad photo
  ('000000d0-0000-0000-0000-000000000005'::uuid, 'app-pio-0005', 'id-and-liveness',
    'completed', 'RED', 'RETRY', '{BAD_PHOTO,SCREENSHOT}',
    'Your document photo is blurry and looks like a screen capture. Please upload a clear photo of the original.',
    'Two attempts, both screenshots. Retry allowed.',
    'Piotr', 'Kowalski', '1993-05-18', 'PL', 'Wrocław', 'male',
    'PASSPORT', 'ZS4410927', '2028-08-30', 92, 88, 8),
  -- pending (in the queue)
  ('000000d0-0000-0000-0000-000000000006'::uuid, 'app-ele-0006', 'id-and-liveness',
    'pending', null, null, '{}', null, null,
    'Eleni', 'Vasiliou', '2001-09-09', 'GR', 'Athens', 'female',
    'ID_CARD', 'AN7710443', '2033-04-18', 12, null, 2),
  -- onHold (manual review)
  ('000000d0-0000-0000-0000-000000000007'::uuid, 'app-gio-0007', 'id-and-liveness',
    'onHold', null, null, '{}',
    'We need a little more time to review your documents.',
    'Name on the ID does not match the SIM contract. Awaiting a support callback.',
    'Giorgos', 'Ioannou', '1985-12-01', 'GR', 'Patras', 'male',
    'ID_CARD', 'AE2288301', '2030-09-27', 60, null, 4),
  -- GREEN / driving licence
  ('000000d0-0000-0000-0000-000000000008'::uuid, 'app-ann-0008', 'id-and-liveness',
    'completed', 'GREEN', null, '{}', null, null,
    'Anna', 'Wiśniewska', '1990-04-27', 'PL', 'Poznań', 'female',
    'DRIVERS', 'DBA771290', '2031-07-14', 268, 267, 16),
  ('000000d0-0000-0000-0000-000000000009'::uuid, 'app-sof-0009', 'id-and-liveness',
    'completed', 'GREEN', null, '{}', null, null,
    'Sofia', 'Papandreou', '1997-08-15', 'GR', 'Athens', 'female',
    'ID_CARD', 'AZ5540118', '2032-12-05', 348, 347, 5),
  ('000000d0-0000-0000-0000-000000000011'::uuid, 'app-chr-0011', 'id-and-liveness',
    'completed', 'GREEN', null, '{}', null, 'Migrated applicant (Atom externalUserId atom-41077).',
    'Christos', 'Makris', '1986-06-06', 'GR', 'Athens', 'male',
    'PASSPORT', 'AP9917724', '2029-02-28', 428, 427, 48),
  -- GREEN but the document has since expired -> users.kyc_status = 'expired'
  ('000000d0-0000-0000-0000-000000000012'::uuid, 'app-ioa-0012', 'id-and-liveness',
    'completed', 'GREEN', null, '{}', null, 'Document expiry passed — force re-KYC before next unlock.',
    'Ioanna', 'Dimitriou', '1994-10-19', 'GR', 'Larissa', 'female',
    'ID_CARD', 'AT3306925', '2026-05-31', 455, 454, 72)
) as a(uid, applicant, level, rstatus, ranswer, rtype, labels, mod_comment, client_comment,
       first_name, last_name, dob, nat, pob, gender, doc_type, doc_no, doc_exp,
       created_days, reviewed_days, synced_h)
join users u on u.id = a.uid
on conflict (id) do nothing;

-- Documents: ID_CARD/DRIVERS get FRONT+BACK, PASSPORT gets FRONT only, everyone gets a SELFIE.
insert into sumsub_documents (
  id, applicant_row_id, image_id, doc_type, doc_sub_type, country, valid_until,
  review_answer, reject_labels, storage_path, content_type, bytes, added_at, created_at
)
select
  md5('penny-seed-sd:' || sa.applicant_id || ':' || d.doc_type || ':' || coalesce(d.sub, 'MAIN'))::uuid,
  sa.id,
  img.image_id,
  d.doc_type,
  d.sub,
  case when d.doc_type = 'SELFIE' then null else sa.id_doc_country end,
  case when d.doc_type = 'SELFIE' then null else sa.id_doc_expiry end,
  -- per-document answer mirrors the applicant verdict; the rejected labels land on the doc
  case when sa.review_answer = 'RED' and d.doc_type <> 'SELFIE' then 'RED'
       when sa.review_answer = 'GREEN' then 'GREEN' end,
  case when sa.review_answer = 'RED' and d.doc_type <> 'SELFIE' then sa.reject_labels
       else '{}'::text[] end,
  'kyc-docs/' || sa.applicant_id || '/' || img.image_id || '.jpg',
  'image/jpeg',
  (180000 + _seed_rnd('bytes:' || img.image_id) * 900000)::int,
  sa.applicant_created_at + interval '4 minutes',
  now()
from sumsub_applicants sa
cross join lateral (
  select * from (values
    (sa.id_doc_type, 'FRONT_SIDE'),
    (sa.id_doc_type, 'BACK_SIDE'),
    ('SELFIE',       null)
  ) as v(doc_type, sub)
  where v.doc_type is not null
    -- passports are single-sided
    and not (v.sub = 'BACK_SIDE' and sa.id_doc_type = 'PASSPORT')
) d
cross join lateral (
  select substr(md5(sa.applicant_id || ':' || d.doc_type || ':' || coalesce(d.sub, 'MAIN')), 1, 20)
         as image_id
) img
where sa.applicant_id like 'app-%'
on conflict (id) do nothing;

-- Review history: 2-4 transitions per applicant, ending on the applicant's current state.
insert into sumsub_review_history (
  id, applicant_row_id, at, review_status, review_answer, review_reject_type,
  reject_labels, moderation_comment, event_id, raw, created_at
)
select
  md5('penny-seed-srh:' || sa.applicant_id || ':' || h.step::text)::uuid,
  sa.id,
  sa.applicant_created_at + (h.after_min || ' minutes')::interval,
  h.rstatus, h.ranswer, h.rtype, h.labels::text[], h.comment,
  'seed-' || substr(md5(sa.applicant_id), 1, 10) || '-' || h.step::text,
  jsonb_build_object('applicantId', sa.applicant_id, 'reviewStatus', h.rstatus,
                     'source', 'seed'),
  now()
from sumsub_applicants sa
cross join lateral (
  select * from (values
    -- step, minutes after creation, status, answer, rejectType, reject labels as CSV, comment
    (1, 0,    'init',       null,             null,                    '', null),
    (2, 3,    'pending',    null,             null,                    '', null),
    (3, 9,    'prechecked', null,             null,                    '', null),
    (4, 26,   sa.review_status, sa.review_answer, sa.review_reject_type,
              coalesce(array_to_string(sa.reject_labels, ','), ''), sa.moderation_comment)
  ) as v(step, after_min, rstatus, ranswer, rtype, labels_csv, comment)
  cross join lateral (
    select case when v.labels_csv is null or v.labels_csv = '' then '{}'
                else '{' || v.labels_csv || '}' end as labels
  ) lb
  -- an applicant still in 'pending' / 'onHold' never reached prechecked+final
  where not (sa.review_status in ('pending', 'onHold') and v.step >= 3)
     or (sa.review_status in ('pending', 'onHold') and v.step = 4)
) h
on conflict (id) do nothing;

-- ===========================================================================
-- 4. Ride history — ~170 trips over the last 90 days
-- ===========================================================================

insert into trips (
  id, user_id, vehicle_id, status, reserved_at, started_at, ended_at,
  start_pos, end_pos, distance_m, duration_s, pause_s, pricing_snapshot,
  cost_cents, discount_cents, bonus_cents, penalty_cents, currency,
  end_photo_url, photo_review, end_zone_id, created_at
)
with
u  as (select id, (row_number() over (order by id)) - 1 as rn
      from users where id::text like '000000d0-0000-0000-0000-%'),
uc as (select count(*)::int as c from u),
v  as (select id, (row_number() over (order by code)) - 1 as rn from vehicles),
vc as (select count(*)::int as c from v),
g as (
  select
    s.i,
    _seed_rnd('u:'  || s.i) as r_user,
    _seed_rnd('v:'  || s.i) as r_veh,
    _seed_rnd('ag:' || s.i) as r_age,
    _seed_rnd('du:' || s.i) as r_dur,
    _seed_rnd('sp:' || s.i) as r_spd,
    _seed_rnd('pa:' || s.i) as r_pause,
    _seed_rnd('st:' || s.i) as r_status,
    _seed_rnd('ph:' || s.i) as r_photo,
    _seed_rnd('pe:' || s.i) as r_pen,
    _seed_rnd('di:' || s.i) as r_disc,
    _seed_rnd('bo:' || s.i) as r_bonus,
    _seed_rnd('sx:' || s.i) as r_slng,
    _seed_rnd('sy:' || s.i) as r_slat,
    _seed_rnd('ex:' || s.i) as r_elng,
    _seed_rnd('ey:' || s.i) as r_elat
  from generate_series(1, 170) as s(i)
),
pick as (
  select g.*, uu.id as user_id, vv.id as vehicle_id
  from g
  cross join uc
  cross join vc
  join u uu on uu.rn = least(uc.c - 1, floor(g.r_user * uc.c)::int)
  join v vv on vv.rn = least(vc.c - 1, floor(g.r_veh  * vc.c)::int)
),
shaped as (
  select
    p.*,
    (now() - ((p.r_age * 90.0 * 86400.0)::bigint || ' seconds')::interval) as started_at,
    (300 + p.r_dur * 2100)::int                                            as duration_s,
    case when p.r_pause < 0.18 then (60 + p.r_pause * 900)::int else 0 end as pause_s,
    (case
       when p.r_status < 0.030 then 'aborted'     -- no DOUT ACK: zero charge (Hard Rule #1)
       when p.r_status < 0.075 then 'disputed'
       when p.r_status < 0.150 then 'ended'       -- capture failed -> debt
       else 'charged'
     end)::trip_status                                                     as status
  from pick p
),
geo as (
  select
    s.*,
    st_setsrid(st_makepoint(23.7065 + s.r_slng * 0.0405, 37.9660 + s.r_slat * 0.0310), 4326) as start_pos,
    st_setsrid(st_makepoint(23.7065 + s.r_elng * 0.0405, 37.9660 + s.r_elat * 0.0310), 4326) as end_pos
  from shaped s
),
priced as (
  select
    g.*,
    case when g.status = 'aborted' then 0
         else (g.duration_s * (2.2 + g.r_spd * 3.3))::int end as distance_m,
    case when g.status = 'aborted' then 0
         else least(2500, 100 + ceil(g.duration_s / 60.0)::int * 15
                              + ceil(g.pause_s / 60.0)::int * 5) end as cost_cents,
    (case when g.status = 'aborted' then null
          when g.r_photo < 0.06 then 'rejected'
          when g.r_photo < 0.12 then 'pending'
          when g.r_photo < 0.38 then 'approved'
          else 'auto_ok' end)::photo_review as photo_review,
    case when g.status = 'aborted' then 0
         when g.r_bonus < 0.12 then 100 else 0 end as bonus_cents
  from geo g
)
select
  md5('penny-seed-trip:' || p.i::text)::uuid,
  p.user_id,
  p.vehicle_id,
  p.status,
  p.started_at - interval '60 seconds',
  p.started_at,
  case when p.status = 'aborted' then p.started_at + interval '8 seconds'
       else p.started_at + ((p.duration_s + p.pause_s) || ' seconds')::interval end,
  p.start_pos,
  case when p.status = 'aborted' then p.start_pos else p.end_pos end,
  p.distance_m,
  case when p.status = 'aborted' then 0 else p.duration_s end,
  case when p.status = 'aborted' then 0 else p.pause_s end,
  jsonb_build_object(
    'unlock_cents', 100, 'per_min_cents', 15, 'pause_per_min_cents', 5,
    'day_cap_cents', 2500, 'currency', 'EUR', 'multiplier', 1, 'seed', 'demo'
  ),
  p.cost_cents,
  -- discount can never exceed the fare
  least(p.cost_cents, case when p.r_disc < 0.15 then 100 + (p.r_disc * 1000)::int else 0 end),
  p.bonus_cents,
  case when p.photo_review = 'rejected' then 500
       when p.status <> 'aborted' and p.r_pen < 0.04 then 1000
       else 0 end,
  'EUR',
  case when p.status = 'aborted' then null
       else 'https://cdn.penny.rent/demo/parking/' || p.i::text || '.jpg' end,
  p.photo_review,
  case when p.bonus_cents > 0 then (select id from zones where kind = 'bonus'  and active limit 1)
       when p.r_photo > 0.55  then (select id from zones where kind = 'parking' and active limit 1)
       else null end,
  p.started_at - interval '60 seconds'
from priced p
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- trip_events — append-only (Hard Rule #4). Last event always matches trips.status.
-- ---------------------------------------------------------------------------
insert into trip_events (id, trip_id, from_status, to_status, at, actor, meta)
-- reserved  (casts on this first branch fix the UNION's column types)
select md5('penny-seed-te:' || t.id::text || ':1')::uuid, t.id,
       null::trip_status, 'reserved'::trip_status,
       t.reserved_at, 'user'::trip_actor, '{"src":"seed"}'::jsonb
from trips t where t.pricing_snapshot->>'seed' = 'demo'
union all
-- unlock command sent
select md5('penny-seed-te:' || t.id::text || ':2')::uuid, t.id, 'reserved', 'unlocking',
       t.started_at - interval '8 seconds', 'user', '{"src":"seed","channel":"gprs"}'::jsonb
from trips t where t.pricing_snapshot->>'seed' = 'demo'
union all
-- DOUT ACK received -> billing may start (Hard Rule #1)
select md5('penny-seed-te:' || t.id::text || ':3')::uuid, t.id, 'unlocking', 'active',
       t.started_at, 'system', '{"src":"seed","dout1_ack_ms":1240}'::jsonb
from trips t where t.pricing_snapshot->>'seed' = 'demo' and t.status <> 'aborted'
union all
-- no ACK within 8 s -> aborted, zero charge (Hard Rule #1)
select md5('penny-seed-te:' || t.id::text || ':3a')::uuid, t.id, 'unlocking', 'aborted',
       t.started_at + interval '8 seconds', 'system',
       '{"src":"seed","reason":"no_dout_ack","charged":false}'::jsonb
from trips t where t.pricing_snapshot->>'seed' = 'demo' and t.status = 'aborted'
union all
-- pause / resume
select md5('penny-seed-te:' || t.id::text || ':4')::uuid, t.id, 'active', 'paused',
       t.started_at + ((t.duration_s / 2) || ' seconds')::interval, 'user', '{"src":"seed"}'::jsonb
from trips t where t.pricing_snapshot->>'seed' = 'demo' and t.status <> 'aborted' and t.pause_s > 0
union all
select md5('penny-seed-te:' || t.id::text || ':5')::uuid, t.id, 'paused', 'active',
       t.started_at + ((t.duration_s / 2 + t.pause_s) || ' seconds')::interval, 'user',
       '{"src":"seed"}'::jsonb
from trips t where t.pricing_snapshot->>'seed' = 'demo' and t.status <> 'aborted' and t.pause_s > 0
union all
-- end requested (photo upload + lock)
select md5('penny-seed-te:' || t.id::text || ':6')::uuid, t.id, 'active', 'ending',
       t.ended_at - interval '20 seconds', 'user', '{"src":"seed","photo":true}'::jsonb
from trips t where t.pricing_snapshot->>'seed' = 'demo' and t.status <> 'aborted'
union all
select md5('penny-seed-te:' || t.id::text || ':7')::uuid, t.id, 'ending', 'ended',
       t.ended_at, 'system',
       jsonb_build_object('src', 'seed', 'distance_m', t.distance_m, 'duration_s', t.duration_s)
from trips t where t.pricing_snapshot->>'seed' = 'demo' and t.status <> 'aborted'
union all
select md5('penny-seed-te:' || t.id::text || ':8')::uuid, t.id, 'ended', 'charged',
       t.ended_at + interval '5 seconds', 'system',
       jsonb_build_object('src', 'seed',
         'amount_cents', t.cost_cents - t.discount_cents - t.bonus_cents + t.penalty_cents)
from trips t where t.pricing_snapshot->>'seed' = 'demo' and t.status in ('charged', 'disputed')
union all
select md5('penny-seed-te:' || t.id::text || ':9')::uuid, t.id, 'charged', 'disputed',
       t.ended_at + interval '2 days', 'admin',
       '{"src":"seed","reason":"rider disputes the parking penalty"}'::jsonb
from trips t where t.pricing_snapshot->>'seed' = 'demo' and t.status = 'disputed'
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- trip_routes — 4-point LineStrings around Athens (jittered off the straight line).
-- ---------------------------------------------------------------------------
insert into trip_routes (trip_id, path, simplified, updated_at)
select
  t.id,
  ln.path,
  st_simplify(ln.path, 0.0002),
  t.ended_at
from trips t
cross join lateral (
  select st_makeline(array[
    t.start_pos,
    st_setsrid(st_makepoint(
      st_x(t.start_pos) + (st_x(t.end_pos) - st_x(t.start_pos)) * 0.33
        + (_seed_rnd('m1x:' || t.id::text) - 0.5) * 0.0025,
      st_y(t.start_pos) + (st_y(t.end_pos) - st_y(t.start_pos)) * 0.33
        + (_seed_rnd('m1y:' || t.id::text) - 0.5) * 0.0025), 4326),
    st_setsrid(st_makepoint(
      st_x(t.start_pos) + (st_x(t.end_pos) - st_x(t.start_pos)) * 0.66
        + (_seed_rnd('m2x:' || t.id::text) - 0.5) * 0.0025,
      st_y(t.start_pos) + (st_y(t.end_pos) - st_y(t.start_pos)) * 0.66
        + (_seed_rnd('m2y:' || t.id::text) - 0.5) * 0.0025), 4326),
    t.end_pos
  ]) as path
) ln
where t.pricing_snapshot->>'seed' = 'demo'
  and t.status <> 'aborted'
on conflict (trip_id) do nothing;

-- ---------------------------------------------------------------------------
-- ride_reviews — ~60 % of completed trips.
-- ---------------------------------------------------------------------------
insert into ride_reviews (id, trip_id, rating, tags, comment, created_at)
select
  md5('penny-seed-rr:' || t.id::text)::uuid,
  t.id,
  case when r.rr < 0.05 then 2 when r.rr < 0.16 then 3 when r.rr < 0.46 then 4 else 5 end,
  case when r.rr < 0.16 then '{brakes,dirty}'::text[]
       when r.rr < 0.46 then '{comfortable}'::text[]
       else '{smooth,clean,fast}'::text[] end,
  case when r.rr < 0.05 then 'Brakes felt weak near Syntagma.'
       when r.rr < 0.16 then 'Scooter was dirty but rideable.'
       when r.rr < 0.46 then 'Fine ride, battery a bit low at the end.'
       else null end,
  t.ended_at + interval '3 minutes'
from trips t
cross join lateral (select _seed_rnd('rate:' || t.id::text) as rr) r
where t.pricing_snapshot->>'seed' = 'demo'
  and t.status in ('charged', 'ended', 'disputed')
  and _seed_rnd('hasrev:' || t.id::text) < 0.60
on conflict (trip_id) do nothing;

-- ---------------------------------------------------------------------------
-- commands — the unlock/lock pair behind every trip (feeds v_vehicle_timeline
-- and v_vehicle_stats.unlock_failures_24h).
-- ---------------------------------------------------------------------------
insert into commands (
  id, vehicle_id, device_id, kind, payload, status, channel, requested_by, trip_id,
  client_command_id, sent_at, acked_at, error, created_at
)
select
  md5('penny-seed-cmd:' || t.id::text || ':unlock')::uuid,
  t.vehicle_id, d.id, 'unlock'::command_kind, '{"dout":1,"pulse_ms":500}'::jsonb,
  (case when t.status = 'aborted' then 'expired' else 'acked' end)::command_status,
  'gprs'::command_channel, t.user_id, t.id,
  'seed-unlock-' || substr(md5(t.id::text), 1, 12),
  t.started_at - interval '7 seconds',
  case when t.status <> 'aborted' then t.started_at end,
  case when t.status = 'aborted' then 'no DOUT ACK within 8s' end,
  t.started_at - interval '8 seconds'
from trips t
left join devices d on d.vehicle_id = t.vehicle_id and d.status = 'active'
where t.pricing_snapshot->>'seed' = 'demo'
union all
select
  md5('penny-seed-cmd:' || t.id::text || ':lock')::uuid,
  t.vehicle_id, d.id, 'lock', '{"dout":1}'::jsonb, 'acked'::command_status,
  'gprs', t.user_id, t.id,
  'seed-lock-' || substr(md5(t.id::text), 1, 12),
  t.ended_at - interval '15 seconds', t.ended_at - interval '13 seconds', null,
  t.ended_at - interval '16 seconds'
from trips t
left join devices d on d.vehicle_id = t.vehicle_id and d.status = 'active'
where t.pricing_snapshot->>'seed' = 'demo' and t.status <> 'aborted'
on conflict (id) do nothing;

-- Two fresh unlock failures on one vehicle in the last 24 h (repeated_unlock_failures rule).
insert into commands (
  id, vehicle_id, device_id, kind, payload, status, channel, requested_by,
  client_command_id, sent_at, error, created_at
)
select
  md5('penny-seed-cmdfail:' || n::text)::uuid,
  v.id, d.id, 'unlock', '{"dout":1}'::jsonb, 'failed'::command_status, 'gprs', null,
  'seed-failunlock-' || n::text,
  now() - (n * 3 || ' hours')::interval,
  'device offline (no GPRS session)',
  now() - (n * 3 || ' hours')::interval
from generate_series(1, 3) as n
cross join lateral (select id from vehicles where code = 'PNY-1004' limit 1) v
left join devices d on d.vehicle_id = v.id and d.status = 'active'
on conflict (id) do nothing;

-- ===========================================================================
-- 5. Money — payments, balanced ledger, debts, top-ups (Hard Rule #2)
-- ===========================================================================

-- Per-user ledger accounts (wallet + debt). Globals were seeded in 00160.
insert into ledger_accounts (id, kind, owner_id, currency)
select md5('penny-seed-la:wallet:' || u.id::text)::uuid, 'user_wallet', u.id, 'EUR'
from users u where u.id::text like '000000d0-0000-0000-0000-%'
on conflict do nothing;

insert into ledger_accounts (id, kind, owner_id, currency)
select md5('penny-seed-la:debt:' || u.id::text)::uuid, 'debt', u.id, 'EUR'
from users u where u.id::text like '000000d0-0000-0000-0000-%'
on conflict do nothing;

-- Trip payments. charged/disputed -> succeeded; ended -> failed (becomes a debt below).
insert into payments (
  id, user_id, trip_id, stripe_pi_id, amount_cents, currency, kind, status,
  failure_code, initiated_by, created_at
)
select
  md5('penny-seed-pay:' || t.id::text)::uuid,
  t.user_id, t.id,
  'pi_demo_' || substr(md5(t.id::text), 1, 20),
  greatest(0, t.cost_cents - t.discount_cents - t.bonus_cents + t.penalty_cents),
  'EUR', 'trip',
  (case when t.status = 'ended' then 'failed' else 'succeeded' end)::payment_status,
  case when t.status = 'ended' then 'card_declined' end,
  'system',
  t.ended_at + interval '4 seconds'
from trips t
where t.pricing_snapshot->>'seed' = 'demo'
  and t.status in ('charged', 'disputed', 'ended')
  and greatest(0, t.cost_cents - t.discount_cents - t.bonus_cents + t.penalty_cents) > 0
on conflict (id) do nothing;

-- Wallet top-ups for three riders.
insert into payments (
  id, user_id, trip_id, stripe_pi_id, amount_cents, currency, kind, status,
  initiated_by, created_at
)
select
  md5('penny-seed-topup:' || u.id::text)::uuid,
  u.id, null, 'pi_demo_topup_' || right(u.id::text, 12),
  (array[1000, 2000, 5000])[1 + floor(_seed_rnd('topup:' || u.id::text) * 3)::int],
  'EUR', 'topup', 'succeeded', 'user', now() - interval '21 days'
from users u
where u.id in (
  '000000d0-0000-0000-0000-000000000001'::uuid,
  '000000d0-0000-0000-0000-000000000009'::uuid,
  '000000d0-0000-0000-0000-000000000002'::uuid
)
on conflict (id) do nothing;

-- Ledger for succeeded TRIP payments: cash in (+) vs revenue (-). Both legs in ONE
-- statement so the deferred balance trigger sees a zero-summing txn (Hard Rule #2).
insert into ledger_entries (id, txn_id, account_id, delta_cents, currency, memo)
select md5('penny-seed-le:' || p.id::text || ':clr')::uuid, p.id,
       (select id from ledger_accounts where kind = 'stripe_clearing' and owner_id is null),
       p.amount_cents, 'EUR', 'trip capture'
from payments p
where p.kind = 'trip' and p.status = 'succeeded' and p.stripe_pi_id like 'pi_demo_%'
union all
select md5('penny-seed-le:' || p.id::text || ':rev')::uuid, p.id,
       (select id from ledger_accounts where kind = 'penny_revenue' and owner_id is null),
       -p.amount_cents, 'EUR', 'trip revenue'
from payments p
where p.kind = 'trip' and p.status = 'succeeded' and p.stripe_pi_id like 'pi_demo_%'
on conflict (id) do nothing;

-- Ledger for top-ups: cash in (+) funds the wallet liability (-).
insert into ledger_entries (id, txn_id, account_id, delta_cents, currency, memo)
select md5('penny-seed-le:' || p.id::text || ':clr')::uuid, p.id,
       (select id from ledger_accounts where kind = 'stripe_clearing' and owner_id is null),
       p.amount_cents, 'EUR', 'wallet top-up'
from payments p where p.kind = 'topup' and p.stripe_pi_id like 'pi_demo_topup_%'
union all
select md5('penny-seed-le:' || p.id::text || ':wal')::uuid, p.id,
       (select id from ledger_accounts where kind = 'user_wallet' and owner_id = p.user_id),
       -p.amount_cents, 'EUR', 'wallet credit'
from payments p where p.kind = 'topup' and p.stripe_pi_id like 'pi_demo_topup_%'
on conflict (id) do nothing;

-- Failed trip captures become open debts (docs/05 retry ladder).
insert into debts (id, user_id, amount_cents, source, status, next_retry_at, attempts, created_at, updated_at)
select
  md5('penny-seed-debt:' || p.id::text)::uuid,
  p.user_id, p.amount_cents, 'failed_trip_payment', 'open',
  now() + interval '6 hours', 1, p.created_at, p.created_at
from payments p
where p.kind = 'trip' and p.status = 'failed' and p.stripe_pi_id like 'pi_demo_%'
on conflict (id) do nothing;

-- Chargeback debt for the blocked rider (matches users.blocked_reason).
insert into debts (id, user_id, amount_cents, source, status, next_retry_at, attempts, created_at, updated_at)
values (md5('penny-seed-debt:chargeback')::uuid,
        '000000d0-0000-0000-0000-000000000011'::uuid, 1420, 'chargeback', 'open',
        null, 0, now() - interval '9 days', now() - interval '9 days')
on conflict (id) do nothing;

-- Ledger for debts: the rider owes (+) and we still recognize the revenue (-).
insert into ledger_entries (id, txn_id, account_id, delta_cents, currency, memo)
select md5('penny-seed-le:' || d.id::text || ':debt')::uuid, d.id,
       (select id from ledger_accounts where kind = 'debt' and owner_id = d.user_id),
       d.amount_cents, 'EUR', 'debt raised: ' || d.source::text
from debts d where d.id in (select md5('penny-seed-debt:' || p.id::text)::uuid
                            from payments p
                            where p.kind = 'trip' and p.status = 'failed'
                              and p.stripe_pi_id like 'pi_demo_%')
                or d.id = md5('penny-seed-debt:chargeback')::uuid
union all
select md5('penny-seed-le:' || d.id::text || ':rev')::uuid, d.id,
       (select id from ledger_accounts where kind = 'penny_revenue' and owner_id is null),
       -d.amount_cents, 'EUR', 'revenue against debt'
from debts d where d.id in (select md5('penny-seed-debt:' || p.id::text)::uuid
                            from payments p
                            where p.kind = 'trip' and p.status = 'failed'
                              and p.stripe_pi_id like 'pi_demo_%')
                or d.id = md5('penny-seed-debt:chargeback')::uuid
on conflict (id) do nothing;

-- ===========================================================================
-- 6. Loyalty, referrals, notifications, audit trail
-- ===========================================================================

insert into loyalty_accounts (user_id, points)
select t.user_id, (sum(t.distance_m) / 1000)::int
from trips t
where t.pricing_snapshot->>'seed' = 'demo' and t.status in ('charged', 'disputed')
group by t.user_id
on conflict (user_id) do nothing;

insert into loyalty_events (id, user_id, delta, reason, trip_id, created_at)
select md5('penny-seed-loy:' || t.id::text)::uuid, t.user_id,
       greatest(1, t.distance_m / 1000), 'ride_km', t.id, t.ended_at
from trips t
where t.pricing_snapshot->>'seed' = 'demo' and t.status = 'charged'
  and _seed_rnd('loy:' || t.id::text) < 0.35
on conflict (id) do nothing;

insert into referrals (id, referrer_id, referee_id, status, reward_cents, created_at)
values
  (md5('penny-seed-ref:1')::uuid, '000000d0-0000-0000-0000-000000000009'::uuid,
   '000000d0-0000-0000-0000-000000000006'::uuid, 'completed', 500, now() - interval '35 days'),
  (md5('penny-seed-ref:2')::uuid, '000000d0-0000-0000-0000-000000000009'::uuid,
   '000000d0-0000-0000-0000-000000000010'::uuid, 'pending', 500, now() - interval '12 days'),
  (md5('penny-seed-ref:3')::uuid, '000000d0-0000-0000-0000-000000000001'::uuid,
   '000000d0-0000-0000-0000-000000000005'::uuid, 'completed', 500, now() - interval '80 days')
on conflict (id) do nothing;

-- Inbox + notification log (feeds v_user_timeline 'notification' rows).
insert into inbox_messages (id, user_id, title, body, deep_link, read_at, created_at)
select
  md5('penny-seed-inbox:' || m.uid::text || ':' || m.k)::uuid,
  m.uid, m.title, m.body, m.link,
  case when m.read then now() - interval '1 day' end,
  now() - (m.days || ' days')::interval
from (values
  ('000000d0-0000-0000-0000-000000000001'::uuid, 'welcome', 'Welcome to Penny',
    'Your account is ready. Scan any scooter to ride.', 'penny://home', true, 405),
  ('000000d0-0000-0000-0000-000000000004'::uuid, 'kyc_rejected', 'Verification failed',
    'We could not verify your identity. Please contact support.', 'penny://kyc', false, 205),
  ('000000d0-0000-0000-0000-000000000005'::uuid, 'kyc_retry', 'Please retry verification',
    'Your document photo was not readable. Upload a clear photo of the original.', 'penny://kyc', false, 88),
  ('000000d0-0000-0000-0000-000000000011'::uuid, 'chargeback', 'Account on hold',
    'A chargeback was received. Your account is on hold pending review.', 'penny://wallet', false, 9),
  ('000000d0-0000-0000-0000-000000000012'::uuid, 'kyc_expired', 'Your ID has expired',
    'Please re-verify your identity before your next ride.', 'penny://kyc', false, 4)
) as m(uid, k, title, body, link, read, days)
on conflict (id) do nothing;

insert into notification_log (
  id, user_id, channel, template_key, payload, status, dedupe_key, sent_at, created_at
)
select
  md5('penny-seed-nl:' || i.user_id::text || ':' || i.title)::uuid,
  i.user_id, 'inbox', lower(replace(i.title, ' ', '_')),
  jsonb_build_object('title', i.title, 'body', i.body),
  'sent', 'seed:' || substr(md5(i.id::text), 1, 16), i.created_at, i.created_at
from inbox_messages i
where i.user_id::text like '000000d0-0000-0000-0000-%'
on conflict (id) do nothing;

-- Staff actions on customers (Hard Rule #8) — these surface as timeline 'audit' rows.
insert into audit_log (id, staff_id, action, entity, entity_id, before, after, reason, ip, at)
select
  md5('penny-seed-audit:' || a.k)::uuid,
  (select id from staff where role = 'owner' limit 1),
  a.action, 'users', a.uid::text, a.before::jsonb, a.after::jsonb, a.reason, '10.0.0.7',
  now() - (a.days || ' days')::interval
from (values
  ('block-dimitris', '000000d0-0000-0000-0000-000000000004'::uuid, 'users.block',
    '{"status":"active"}', '{"status":"blocked"}',
    'Sumsub returned RED/FINAL with label FORGERY — permanent decline.', 205),
  ('block-christos', '000000d0-0000-0000-0000-000000000011'::uuid, 'users.block',
    '{"status":"active"}', '{"status":"blocked"}',
    'Chargeback received on pi_demo — account on hold pending evidence pack.', 9),
  ('note-giorgos', '000000d0-0000-0000-0000-000000000007'::uuid, 'users.note_added',
    '{}', '{"internal_notes":"On hold at Sumsub: name mismatch vs. the phone contract."}',
    'Support triage note.', 4),
  ('rekyc-ioanna', '000000d0-0000-0000-0000-000000000012'::uuid, 'users.force_rekyc',
    '{"kyc_status":"approved"}', '{"kyc_status":"expired"}',
    'ID document expiry date passed.', 3)
) as a(k, uid, action, before, after, reason, days)
on conflict (id) do nothing;

-- ===========================================================================
-- 7. Fleet history — telemetry, alerts, status log, damage, swaps, maintenance
-- ===========================================================================

-- Hourly telemetry for the last 21 days (feeds admin-vehicle-history telemetry_summary).
insert into telemetry (
  id, device_id, vehicle_id, device_ts, server_ts, pos, speed_kmh, heading,
  sats, hdop, ext_voltage_mv, batt_voltage_mv, din1, dout1, dout2, gsm_signal, io
)
select
  md5('penny-seed-tel:' || d.id::text || ':' || h::text)::uuid,
  d.id, d.vehicle_id,
  now() - (h || ' hours')::interval - interval '3 seconds',
  now() - (h || ' hours')::interval,
  st_setsrid(st_makepoint(
    23.7065 + _seed_rnd('tlx:' || d.id::text || h::text) * 0.0405,
    37.9660 + _seed_rnd('tly:' || d.id::text || h::text) * 0.0310), 4326),
  (_seed_rnd('tsp:' || d.id::text || h::text) * 22)::real,
  (_seed_rnd('thd:' || d.id::text || h::text) * 360)::real,
  (7 + _seed_rnd('tst:' || d.id::text || h::text) * 6)::smallint,
  (0.6 + _seed_rnd('thp:' || d.id::text || h::text))::real,
  -- SoC drifts down over the window then jumps back up on a swap
  (33000 + ((h % 168) / 168.0) * 8000 + _seed_rnd('tv:' || d.id::text || h::text) * 400)::int,
  4050,
  false,
  false,
  false,
  (12 + _seed_rnd('tgs:' || d.id::text || h::text) * 19)::smallint,
  jsonb_build_object('239', 0, '240', 1, '21', 4, 'seed', true)
from devices d
cross join generate_series(0, 21 * 24) as h
where d.vehicle_id is not null
on conflict do nothing;

insert into vehicle_alerts (id, vehicle_id, kind, payload, ack_by, ack_at, created_at)
select
  md5('penny-seed-va:' || a.k)::uuid,
  (select id from vehicles where code = a.code), a.kind::alert_kind, a.payload::jsonb,
  case when a.acked then (select id from users where id::text like '000000aa-%' limit 1) end,
  case when a.acked then now() - ((a.hours - 1) || ' hours')::interval end,
  now() - (a.hours || ' hours')::interval
from (values
  ('lowbatt-1004', 'PNY-1004', 'low_batt',  '{"soc_pct":11,"threshold":20}', false, 5),
  ('offline-1004', 'PNY-1004', 'offline',   '{"minutes_offline":95}',        false, 3),
  ('fall-1002',    'PNY-1002', 'fall',      '{"tilt_deg":74,"sustained_s":14}', true, 30),
  ('moved-1006',   'PNY-1006', 'moved_locked', '{"moved_m":48,"locked":true}', true, 52),
  ('powercut-1003','PNY-1003', 'power_cut', '{"ext_voltage_mv":0}',          true, 100),
  ('error-1005',   'PNY-1005', 'error',     '{"source":"damage_report","code":"brake"}', false, 20),
  ('geo-1001',     'PNY-1001', 'geofence_exit', '{"zone":"Athens Centre","distance_m":120}', true, 140)
) as a(k, code, kind, payload, acked, hours)
on conflict (id) do nothing;

insert into vehicle_status_log (id, vehicle_id, from_status, to_status, by, role, reason, pos, at)
select
  md5('penny-seed-vsl:' || s.k)::uuid,
  (select id from vehicles where code = s.code),
  s.from_st::vehicle_status, s.to_st::vehicle_status,
  (select user_id from staff where role = 'owner' limit 1), 'owner', s.reason,
  (select pos from vehicle_state vs join vehicles v on v.id = vs.vehicle_id where v.code = s.code),
  now() - (s.hours || ' hours')::interval
from (values
  ('1004-lowbatt', 'PNY-1004', 'available',   'low_battery', 'SoC below 15% — queued for battery swap', 6),
  ('1004-maint',   'PNY-1004', 'low_battery', 'maintenance', 'Repeated unlock failures — bench check', 2),
  ('1005-maint',   'PNY-1005', 'available',   'maintenance', 'Brake damage report confirmed', 19),
  ('1005-back',    'PNY-1005', 'maintenance', 'available',   'Brake pads replaced, road tested', 4),
  ('1003-trans',   'PNY-1003', 'available',   'transport',   'Rebalancing to Omonoia bonus zone', 44),
  ('1003-back',    'PNY-1003', 'transport',   'available',   'Deployed at Omonoia', 41)
) as s(k, code, from_st, to_st, reason, hours)
on conflict (id) do nothing;

-- Damage reports — two filed by riders off real seeded trips, one by ops.
insert into damage_reports (
  id, vehicle_id, reporter, user_id, trip_id, description, photos, severity, status, created_at
)
select
  md5('penny-seed-dmg:' || x.k)::uuid, t.vehicle_id, x.reporter::damage_reporter,
  t.user_id, t.id, x.description,
  array['https://cdn.penny.rent/demo/damage/' || x.k || '-1.jpg'],
  x.severity::damage_severity, x.status::damage_status, t.ended_at + interval '2 minutes'
from (values
  ('brake', 'rider', 'Rear brake lever is loose, barely stops the scooter.', 'high',   'confirmed', 3),
  ('deck',  'rider', 'Deck grip tape torn, screws exposed.',                 'medium', 'fixed',     17),
  ('light', 'rider', 'Front light does not turn on at night.',               'low',    'new',       31)
) as x(k, reporter, description, severity, status, nth)
join lateral (
  select t2.id, t2.vehicle_id, t2.user_id, t2.ended_at
  from trips t2
  where t2.pricing_snapshot->>'seed' = 'demo' and t2.status = 'charged'
  order by t2.started_at desc
  offset x.nth limit 1
) t on true
on conflict (id) do nothing;

insert into damage_reports (
  id, vehicle_id, reporter, user_id, trip_id, description, photos, severity, status, created_at
)
select md5('penny-seed-dmg:vandal')::uuid, (select id from vehicles where code = 'PNY-1006'),
       'ops', null, null, 'QR sticker peeled off and throttle cable cut — suspected vandalism.',
       array['https://cdn.penny.rent/demo/damage/vandal-1.jpg'], 'critical', 'confirmed',
       now() - interval '26 hours'
on conflict (id) do nothing;

insert into battery_swaps (id, vehicle_id, by, at, voltage_before, voltage_after)
select
  md5('penny-seed-bs:' || b.k)::uuid,
  (select id from vehicles where code = b.code),
  (select user_id from staff where role = 'owner' limit 1),
  now() - (b.days || ' days')::interval, b.before_mv, b.after_mv
from (values
  ('1004-a', 'PNY-1004', 31800, 41900, 2),
  ('1004-b', 'PNY-1004', 32400, 41850, 16),
  ('1006-a', 'PNY-1006', 33100, 41920, 9),
  ('1002-a', 'PNY-1002', 32900, 41880, 23),
  ('1003-a', 'PNY-1003', 33400, 41900, 37)
) as b(k, code, before_mv, after_mv, days)
on conflict (id) do nothing;

insert into maintenance_log (id, vehicle_id, task_id, parts, cost_cents, notes, created_at)
select
  md5('penny-seed-ml:' || m.k)::uuid,
  (select id from vehicles where code = m.code), null, m.parts::jsonb, m.cost, m.notes,
  now() - (m.days || ' days')::interval
from (values
  ('1005-brake', 'PNY-1005', '[{"sku":"BRK-PAD-01","qty":2}]', 1800, 'Rear brake pads + cable replaced.', 4),
  ('1004-bench', 'PNY-1004', '[{"sku":"FMB930-ANT","qty":1}]', 2400, 'GSM antenna reseated after unlock failures.', 2),
  ('1006-deck',  'PNY-1006', '[{"sku":"GRIP-TAPE","qty":1}]',  600, 'Grip tape re-applied.', 15),
  ('1002-tyre',  'PNY-1002', '[{"sku":"TYRE-85","qty":1}]',   2900, 'Front tyre replaced (puncture).', 28)
) as m(k, code, parts, cost, notes, days)
on conflict (id) do nothing;

-- ===========================================================================
-- 8. Verification — fail loudly if the demo data is not coherent
-- ===========================================================================
do $$
declare
  n_users int; n_applicants int; n_docs int; n_hist int;
  n_trips int; n_events int; n_routes int; n_reviews int;
  n_payments int; n_debts int; n_tel int;
  ledger_sum bigint; unbalanced int;
begin
  select count(*) into n_users      from users where id::text like '000000d0-%';
  select count(*) into n_applicants from sumsub_applicants;
  select count(*) into n_docs       from sumsub_documents;
  select count(*) into n_hist       from sumsub_review_history;
  select count(*) into n_trips      from trips where pricing_snapshot->>'seed' = 'demo';
  select count(*) into n_events     from trip_events;
  select count(*) into n_routes     from trip_routes;
  select count(*) into n_reviews    from ride_reviews;
  select count(*) into n_payments   from payments;
  select count(*) into n_debts      from debts;
  select count(*) into n_tel        from telemetry;

  select coalesce(sum(delta_cents), 0) into ledger_sum from ledger_entries;
  select count(*) into unbalanced from (
    select txn_id from ledger_entries group by txn_id having sum(delta_cents) <> 0
  ) q;

  -- Hard Rule #2: the whole ledger and every individual txn must net to zero.
  if ledger_sum <> 0 then
    raise exception 'SEED FAILED: ledger_entries sum = % (must be 0 — Hard Rule #2)', ledger_sum;
  end if;
  if unbalanced > 0 then
    raise exception 'SEED FAILED: % unbalanced ledger txns (Hard Rule #2)', unbalanced;
  end if;
  -- Hard Rule #4: trips.status must equal the last trip_events row.
  if exists (
    select 1 from trips t
    join lateral (select to_status from trip_events e where e.trip_id = t.id
                  order by e.at desc, e.id desc limit 1) le on true
    where t.pricing_snapshot->>'seed' = 'demo' and le.to_status <> t.status
  ) then
    raise exception 'SEED FAILED: a trip.status does not match its last trip_events row (Hard Rule #4)';
  end if;
  -- Hard Rule #1: an aborted unlock must never be charged.
  if exists (
    select 1 from trips t join payments p on p.trip_id = t.id where t.status = 'aborted'
  ) then
    raise exception 'SEED FAILED: an aborted trip has a payment (Hard Rule #1)';
  end if;

  raise notice 'SEED OK — users:% applicants:% docs:% review_history:%',
    n_users, n_applicants, n_docs, n_hist;
  raise notice 'SEED OK — trips:% events:% routes:% reviews:% payments:% debts:% telemetry:%',
    n_trips, n_events, n_routes, n_reviews, n_payments, n_debts, n_tel;
  raise notice 'SEED OK — ledger nets to 0 across % txns', (select count(distinct txn_id) from ledger_entries);
end $$;

drop function if exists _seed_rnd(text);
