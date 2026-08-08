# 09 — Migration from Atom Mobility

## Inventory to extract from Atom (export/API/CSV — verify what Atom gives us)

users (id, phone, email, name, signup date, KYC state), wallet balances, active packages/subscriptions, open debts, promo codes active, ride history (min: aggregates per user; ideal: full trips), invoices/receipts archive, vehicles + IMEI mapping, zones (GeoJSON if exportable, else redraw), pricing config, corporate accounts.

## Users

- Import → `users` with `legacy_atom_user_id`; auth = **phone OTP only** (no password migration problem). First login links `auth.users` by phone match; email fallback with manual support path for changed numbers.
- **Sumsub:** our own app token ⇒ applicants are ours. Mapping: pull applicants via API, match `externalUserId` (= Atom user id) → set `sumsub_applicant_id`, copy review status. Unmatched → `kyc_status=none` (re-KYC on first unlock). Webhook target switched to our edge fn at cutover.
- Consents: require re-accept of our ToS/Privacy on first login (new data controller processes).

## Cards (decision needed early — start Stripe request NOW)

- If Atom's PSP account is theirs: file **Stripe card data migration** (PSP→our Stripe or Stripe→Stripe). Needs Atom cooperation; lead time weeks. Parallel plan: cutover campaign "confirm your card" with incentive (e.g., 15 free minutes) — measure re-add conversion in pilot cohort.
- Wallet balances & packages: honored 1:1 → opening `ledger_entries` batch (source `migration`), package_purchases with remaining minutes. Open debts imported to `debts`.

## Fleet (per docs/03 FOTA)

bench 1 → pilot 5–10 (dual-run: these vehicles hidden in Atom, visible in Penny app) → batches. `devices.server_profile` tracks progress. Success gate per batch: unlock_success ≥ 98%, telemetry gap ≤ Atom baseline.

## Dual-run & cutover plan

1. **T-8 w:** pilot fleet live for staff + friendly users (TestFlight/internal). Real payments in test cohort.
2. **T-4 w:** public soft launch of new app (both apps in stores), pilot city area; Atom still primary.
3. **T-2 w:** migrate 50% fleet; in-app + email + push campaign in Atom app ("switch to new Penny app, your account is waiting — log in with your phone number"). Store listings swapped/linked.
4. **T-0:** remaining fleet switched; Atom subscription notice period respected (check contract termination terms + data export deadlines BEFORE T-8).
5. **T+4 w:** Atom off; keep exports archived (invoices, rides) in R2.

Rollback at any point: FOTA re-profile devices to `atom` (minutes per device).

## Data mapping table

Maintain `docs/migration-mapping.xlsx`-style table in `docs/mapping.md`: Atom field → Penny table.column → transform → verified(✓). No field marked done without a row-count + checksum spot check.
