# Atom → Penny data mapping

Working sheet for the migration (docs/09). **No row marked ✓ without a
row-count + checksum spot check.** Add rows as Atom exports are received.

| Atom field / export | Penny table.column | Transform | Verified |
|---|---|---|---|
| user.id | `users.legacy_atom_user_id` | store as text, exact | ☐ |
| user.phone | `users.phone` | normalize to E.164 | ☐ |
| user.email | `users.email` | lowercase | ☐ |
| user.name | `users.full_name` | trim | ☐ |
| user.kyc_state | `users.kyc_status` | map enum (see below) | ☐ |
| Sumsub applicant (externalUserId = Atom user id) | `users.sumsub_applicant_id` | pull via API, match | ☐ |
| wallet balance | opening `ledger_entries` (source `migration`) | cents, balanced vs `bonus`/`user_wallet` | ☐ |
| active package | `package_purchases` | remaining minutes, expiry | ☐ |
| open debt | `debts` | source=failed_trip_payment | ☐ |
| promo code | `promo_codes` | active only | ☐ |
| ride history | `trips` (+`trip_events` synthetic) | aggregates min; full ideal | ☐ |
| invoice/receipt archive | R2 archive + `invoices` | keep per Greek tax law | ☐ |
| vehicle + IMEI | `vehicles` + `devices.imei` | exact IMEI, link `vehicle_id` | ☐ |
| zone GeoJSON | `zones` (+`zone_versions` v1) | reproject to 4326 if needed | ☐ |
| pricing config | `pricing_plans` | per city/model | ☐ |
| corporate account | `corporate_accounts` + `corporate_members` | monthly invoicing flag | ☐ |

## Enum maps

**KYC state:** Atom `verified`→`approved`, `pending`→`pending`,
`rejected`→`rejected`, `none`/null→`none`, expired→`expired`.

**Vehicle status:** map Atom operational states to
`available|maintenance|transport|offline|decommissioned`; unknown → `offline`
pending inspection.

## Verification protocol

1. Export batch → staging table.
2. `SELECT count(*)` source vs target must match.
3. Checksum a sampled 1% (phone, balance, imei) by hand.
4. Only then flip the row to ✓.
