# 00 — Atom parity checklist (nothing omitted) + upgrades

Source: current Atom panel (screens audited 2026-08). ✅ = covered in docs, 🆕 = beyond Atom.

| Atom feature | Where in spec |
|---|---|
| Dashboard | docs/08 Dashboard ✅ |
| Ride verification (photo queue) | docs/04 + docs/08 ✅ + 🆕 AI pre-screen |
| Rides (list/detail) | docs/08 ✅ + 🆕 route playback, telemetry chart |
| Vehicles | docs/08 ✅ + 🆕 command console, device swap wizard, QR print |
| Customers | docs/08 ✅ + 🆕 ledger view, GDPR tools, rider score |
| Analytics | docs/08 ✅ + 🆕 heatmaps start/end/idle, cohorts, report builder |
| System preferences | docs/08 Settings ✅ |
| Vehicle models | docs/02 + 08 ✅ + 🆕 battery curves editor |
| Dynamic pricing | docs/04 + 08 ✅ + 🆕 transparent pre-ride multiplier |
| Reaction test | docs/02 + 06 ✅ |
| Customer form | docs/02 + 08 ✅ |
| Transaction history | docs/05 + 08 ✅ |
| Main/Short tutorial, App localization, Map icons | docs/02 app_content/translations + 08 Settings ✅ |
| Team permissions / Subaccounts / Corporate accounts / Employee activity log | docs/02 staff+audit + 08 ✅ |
| MDS / GBFS | docs/10 ✅ |
| Promo codes / Customer groups / Loyalty / POI / Push / Email marketing | docs/02 + 08 ✅ + 🆕 referrals |
| Task manager / Damage reports | docs/07 + 08 ✅ + 🆕 auto-generated tasks from heatmaps/alerts |
| Manage IoT / IoT data log / Scan data log / Vehicle error log | docs/02 + 03 + 08 ✅ + 🆕 hex frame viewer |
| Subscriptions / Manage FAQ / Purchase history / Add-ons | docs/05 + 08 ✅ |
| Zones: Parking, Paid parking, Parking station, Charging station, No parking, Bonus, Speed limit, No-go, Rebalancing | docs/02 + 04 ✅ (speed limit = info-only on FMB930) |
| Pricing packages | docs/05 ✅ |
| Alerts & notifications | docs/02 vehicle_alerts + 08 Settings rules ✅ |

Requested explicitly by owner and covered: heatmaps of trip starts/ends ✅, full ride history ✅, detailed customer data ✅, reports+sorting everywhere ✅, **manual card charge from panel** ✅ (reason+audit mandatory), map/zone modification ✅, adding new IoT devices ✅, extra analytics ✅, ops tasks ✅, damage reports ✅, battery % (voltage curve, confirmed working) ✅.

Known FMB930 limits accepted: no enforced speed limit, no BLE unlock, 2G-only latency (mitigated: SMS fallback, no-deep-sleep profile).

**Additions (2nd pass, owner request):** notification engine with editable rules ✅ docs/12 — incl. **email when vehicle moves without rental**, **email/alert when vehicle offline > X min**, full staff alert catalogue (20 events), full rider push/email catalogue (transactional + lifecycle automations: welcome, abandoned onboarding, win-back, NPS), weekly owner email report 🆕, in-app inbox 🆕, geo-push bonus zones 🆕, detailed onboarding flow with progressive permissions + funnel tracking ✅, main/short/contextual tutorials + parking school 🆕, ops-app onboarding 🆕.

**Additions (3rd pass):** DOUT2 = siren — ring + alarm commands with failsafe OFF ✅ docs/03; explicit vehicle status transition matrix + `vehicle_status_log` with photos ✅ docs/07; visibility toggle (`vehicles.visible`) ✅; photos attachable to every ops action ✅; competitive audit of Lime/Bolt/Voi/Dott-TIER/Bird/Hopp/blinkee with adopt/later/skip decision per feature ✅ docs/13 — adopted: group rides 🆕, Apple/Google Pay 🆕, share-my-ride 🆕, crash check-in + emergency contact 🆕, CO2/stats/recap + parking streak 🆕, mid-ride battery swap suggestion 🆕.
