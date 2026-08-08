# 06 — Rider app (Expo, @rnmapbox/maps)

## Screens

1. **Map (home):** clustered available vehicles (from `v_public_vehicles`, bbox realtime), zone overlays (parking green, no-parking red hatch, no-go dark, bonus glow, paid-parking icon, stations), POI layer, battery % + range estimate on pin tap, walk-to route, reserve button, dynamic-price badge if multiplier active.
2. **Scan/unlock:** QR scan (expo-camera) + manual code entry; flashlight; scan logged to `scan_data_log`; pre-unlock sheet: price, add-on insurance toggle, promo field, package/subscription auto-applied preview.
3. **Active ride:** big timer + live cost, battery, pause/resume, ring/locate (short DOUT beep if wired / locate cmd), zone banners (speed-limit info, no-go alarm), end-ride slider.
4. **End ride:** parking photo (forced camera, no gallery), zone check result, receipt summary, rating + tags, damage report shortcut.
5. **Wallet:** cards (add via Stripe SDK), wallet balance + top-up, packages store, subscriptions, add-ons, promo entry, debt banner + pay.
6. **History:** trips with mini route map, receipts (PDF), dispute button (reason + photos → `disputed`).
7. **Profile:** personal data (customer_form extra fields), documents/KYC status (Sumsub SDK re-verification), language (PL/EN/EL via `translations`), consents, notifications prefs, referral code share, loyalty points, delete account (GDPR flow).
8. **Onboarding:** phone OTP → name/email → consents → customer form → Sumsub KYC (skippable until first unlock attempt) → card (skippable until first unlock) → main tutorial (content from `app_content`).
9. **Support:** FAQ (`faq_items`), contact (deep link mail/WhatsApp), report vehicle problem from map pin (creates `damage_reports` without trip).
10. **Reaction test:** (night gate) simple tap-reaction mini-test per config; result stored; fail → soft block till morning + info.

## Cross-cutting

- Push: Expo notifications; campaign pushes via `push_campaigns` (segment resolved server-side).
- Offline/poor 2G handling: unlock screen shows explicit progress ("waking vehicle… up to 20 s"); all mutations idempotent with client-generated ids.
- Deep links: `penny://vehicle/{code}` from QR, marketing links.
- Analytics events (PostHog self-host or Supabase table): funnel scan→unlock→charged; every refusal reason surfaced (drives conversion fixes).
- Accessibility: min touch 44 pt, dynamic type, Greek diacritics fonts checked.
- Design: shared `packages/ui`; light theme, Penny blue; map style day/night.

## 2nd-pass additions (competitive audit, docs/13)

- **Group ride:** initiator unlocks up to 4 extra vehicles (config) from one account; per-vehicle sub-trips under `trips.group_id`; single payer; every scooter ends with its own photo; group summary receipt.
- **Ring the scooter:** button on pin + pre-unlock sheet (within 100 m) → DOUT2 siren pulses.
- **Share my ride:** live-trip link (signed URL, expires at trip end) — position, ETA, battery.
- **Crash check-in:** fall detected during trip → "are you OK?" full-screen prompt → no response 60 s → SMS emergency contact (optional, set in Profile) + support alert.
- **Stats & recap:** per-trip km/CO2/cost; profile lifetime stats; shareable yearly recap card; parking streak counter (gamified rider score).
- **Wallet:** Apple Pay / Google Pay via Stripe PaymentSheet as first-class methods.
- Mid-ride low battery push + nearest available vehicle suggestion.
