# 10 — Compliance, monitoring, reliability

## GDPR

- Controller: Penny.rent entity. RoPA + DPIA for location data (template task).
- Lawful bases: contract (rides), legitimate interest (fraud/theft telemetry), consent (marketing).
- Retention: see docs/02; user-linked GPS 90 d raw / 24 mo downsampled-pseudonymized; KYC per AML-ish/Sumsub guidance + dispute windows.
- Rights: export (edge fn assembles JSON+PDF), delete (anonymize user row, detach trips to pseudonym, keep financial records per tax law), consent log.
- Processors list: Supabase, Stripe, Sumsub, Mapbox, Expo, SMS provider, Resend, Cloudflare, Hetzner (DPA links in `docs/processors.md`).

## Greece specifics (re-verify at implementation)

- myDATA e-receipts via certified provider (docs/05).
- Local micromobility rules (helmet/age/where scooters may ride, city agreements) → config, not code assumptions.
- Consumer law: refund/appeal paths documented in ToS; penalty amounts disclosed in-app before ride.

## Public feeds (parity: GBFS + MDS)

- GBFS 2.3: system_information, station_information/status (if stations), free_bike_status (available vehicles, rounded coords per spec), pricing. Edge fn, cached 30 s, public.
- MDS (city authorities): provider API subset (trips, status changes) behind API key per agency; only if/when a city requires — keep adapter thin.

## SLOs & alerting

| SLO | Target | Alert |
|---|---|---|
| unlock_success_rate (5 min) | ≥ 97% | < 95% page |
| cmd ACK p95 | ≤ 6 s | > 10 s warn |
| fleet offline % | ≤ 5% | > 10% page |
| payment failure rate | ≤ 8% | > 15% warn |
| photo queue age p95 | ≤ 2 h | > 6 h warn |
| gateway uptime | 99.9% | probe fail page |

Alert routes: Telegram (ops), phone call via Better Stack for pages. Status page public (status.penny.rent).

## Runbooks (docs/runbooks/)

gateway down, mass offline (carrier outage — check 2G status first), stuck trip (no lock ACK), Stripe outage (queue captures), device firmware bad batch (FOTA rollback), DB failover, SMS budget spike.

## Security

- Gateway: rate-limit unknown IMEIs, allowlist optional by ICCID prefix; no TLS on FMB930 stream (2G/plain) — treat payload as untrusted input, strict parser, fuzz tests.
- Edge fns: zod-validate everything; permission matrix tests.
- Secrets: Supabase vault + GH environments; no secrets in app bundles.
- Admin: WebAuthn/passkey for staff, IP log, session revoke.
