# 13 — Competitive feature matrix (Lime, Bolt, Voi, Dott/TIER, Bird, Hopp, blinkee) → decisions

Audit of what riders know from competitor apps in EU markets. Every row = decision: **ADOPT** (in spec, doc ref), **LATER** (backlog, reason), **SKIP** (reason). Nothing left unclassified.

## Riding & unlock

| Feature | Seen in | Decision |
|---|---|---|
| QR + code entry unlock | all | ADOPT (docs/06) ✅ |
| **Group ride** (1 account unlocks 2–5 vehicles for friends) | Lime, Bolt, Voi | **ADOPT** — `trips.group_id`, payer = initiator, per-vehicle sub-trips, all must end with photo; huge for tourists in Greece. Added docs/06 |
| Guest/web checkout (ride without app) | Bird (legacy) | SKIP — KYC + card friction makes it moot; QR lands on app-store smart link |
| Reservation with countdown | all | ADOPT ✅ (docs/04) |
| Scheduled reservation (book for later time) | Bolt (cars), rare in scooters | LATER — low demand, cannibalizes availability |
| Beginner / reduced-speed mode | Lime, Voi | **SKIP on FMB930** (no controller link — cannot enforce). Flag for LTE-M hardware refresh (docs/11 backlog) |
| Ring/find my scooter | Lime, Bolt | ADOPT — DOUT2 siren pulses (docs/03/07) ✅ |
| Pause/hold mid-ride | all | ADOPT ✅ |
| Multi-city auto-switch | all | ADOPT — cities table already; app picks city by location ✅ |
| Low-battery warning mid-ride + nearest-vehicle swap suggestion | Voi | ADOPT — push when soc < 15% in trip + map CTA (docs/12 catalogue) |

## Safety

| Feature | Seen in | Decision |
|---|---|---|
| Helmet selfie (AI verify) for bonus | Lime | LATER — nice PR, needs CV tuning; reuse photo-review pipeline when done |
| Reaction test night gate | Voi, Bolt | ADOPT ✅ (parity, docs/04) |
| **Share my ride** (live trip link to a friend) | Lime, Bolt | **ADOPT** — signed public URL, live position while trip active, auto-expire. Added docs/06 |
| Crash detection → check-in push → emergency contact | Lime | ADOPT (we already detect fall server-side): if fall DURING trip → push "are you OK?" → no answer 60 s → SMS to emergency contact (optional profile field) + support alert. Added docs/12 |
| Safety school / quiz with reward | Voi (RideSafe) | LATER — content effort; parking school ships first (docs/12) |
| First-ride mode (extra hints, gentler UX) | Voi | ADOPT — contextual tooltips already spec'd (docs/12 E) ✅ |

## Parking

| Feature | Seen in | Decision |
|---|---|---|
| Mandatory end photo | all | ADOPT ✅ |
| AI photo scoring w/ instant feedback | Lime, Voi | ADOPT ✅ (docs/04, ours auto-approves too) |
| Parking racks/spots with bonus | Voi, Dott/TIER | ADOPT — bonus + parking_station zones ✅ |
| Good-parker streaks / score visible to user | Voi | ADOPT — rider score partially exposed as "parking streak" gamification. Added docs/06 |
| Report badly parked vehicle (community) | Bird, Lime | ADOPT — map pin → report with photo → damage_reports(kind extended) + ops task ✅ (docs/06 support) |

## Payments & pricing

| Feature | Seen in | Decision |
|---|---|---|
| **Apple Pay / Google Pay** | all | **ADOPT — MANDATORY.** Stripe PaymentSheet; wallet-first checkout massively lifts conversion. Added docs/05 |
| PayPal | Bolt DE | SKIP for GR launch (Stripe coverage fine); revisit if expansion |
| Ride passes / bundles | Lime (LimePass), Bolt | ADOPT ✅ packages/subscriptions |
| Day cap pricing | Dott | ADOPT ✅ |
| Price shown before unlock incl. dynamic | Bolt | ADOPT ✅ |
| Student / social discount groups | Lime Access, Voi | ADOPT via customer_groups + promo auto-attach ✅ |
| Cash/voucher top-up | Bird (US) | SKIP — no GR retail network worth it |

## Engagement

| Feature | Seen in | Decision |
|---|---|---|
| CO2 saved / km stats / yearly recap | Lime, Voi | ADOPT — per-trip + profile lifetime stats, shareable recap card. Added docs/06 |
| Badges/achievements | Voi | LATER — after loyalty proves engagement |
| Referral two-sided | all | ADOPT ✅ |
| Loyalty points/credits | Voi, Lime Prime | ADOPT ✅ |
| Weather/service banners | Voi | ADOPT ✅ (docs/12 service alerts) |
| In-app support chat | Bolt | LATER — start with FAQ + mail/WhatsApp deep link (docs/06); chat = support headcount question, not tech |
| Rate ride + tags | all | ADOPT ✅ |

## Ops-side (from MDS ecosystems / job ads / teardowns)

| Feature | Seen in | Decision |
|---|---|---|
| Auto task generation from telemetry | Lime/Voi internal | ADOPT ✅ (docs/07) |
| Battery-swap route optimization | TIER internal | ADOPT (simple NN now, ML later) ✅ |
| Vandalism/theft siren + alerts | all | ADOPT ✅ DOUT2 |
| City-authority MDS feeds | all EU | ADOPT ✅ |

## Net-new adoptions from this audit (patched into docs)

1. **Group rides** (docs/06) — biggest revenue feature we lacked.
2. **Apple Pay / Google Pay** via Stripe PaymentSheet (docs/05).
3. **Share my ride** safety link (docs/06).
4. **Crash check-in + emergency contact** (docs/12).
5. Mid-ride low-battery push + swap suggestion (docs/12).
6. CO2/stats/recap + parking streak (docs/06).
7. Community bad-parking report already covered; extended with photo requirement.

FMB930-blocked (explicit): beginner speed mode, sidewalk detection, enforced slow zones, BLE unlock — all queued behind hardware refresh (docs/11 backlog).
