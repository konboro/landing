# 08 — Admin panel (web) — full Atom parity + upgrades

React + Vite + Mapbox GL JS, Cloudflare Pages. Auth: Supabase (staff), role-gated routes; ALL mutations via edge functions with permission check + audit.

## Navigation (superset of Atom)

**Dashboard** — live KPIs: active rides, today revenue/rides/new users, fleet split by status, unlock success rate (24 h), open debts total, alerts feed. Sparklines 7 d.

**Ride verification** — photo queue (AI-prescreened; only `pending` humans must touch): keyboard-driven approve/reject with reason presets, penalty trigger, user history side-panel. Queue SLA metric.

**Rides** — table with server-side sort/filter/search (user, vehicle, city, status, date range, price range, has-dispute, has-penalty), CSV export, row → **Ride detail**: full route on map (animated playback), telemetry chart (speed/battery), event timeline (trip_events + commands), payments, photo, actions (refund, adjust price, mark disputed resolution).

**Vehicles** — table (sort by battery, last_seen, status, rides today, idle time), bulk actions, row → **Vehicle detail**: live position, telemetry graphs, IoT session log, command console (unlock/lock/locate/reboot/raw-with-permission), rides history, maintenance history, damage reports, device info (IMEI/ICCID/fw), swap device wizard, QR label print (PDF).

**Customers** — table (search phone/email/name/legacy id; sort by rides, spend, debt, score, signup), row → **Customer detail** (requested "dokładne dane"): profile + KYC status with Sumsub deep link, documents, rides, payments & ledger, debts (retry now / write-off), penalties, disputes, devices used, referrals, loyalty, notes; actions: **charge card (reason+evidence mandatory)**, refund, credit wallet, block/unblock, force re-KYC, GDPR export/delete, impersonate-view (read-only).

**Analytics** (requested "dodatkowe dane analityczne") —
- **Heatmaps: trip starts / trip ends / idle time**, hour-of-day + day-of-week slicers, zone overlay toggle.
- Demand vs supply per grid cell; suggested rebalance list (one-click create tasks).
- Revenue: by day/city/model/product (trips, packages, subs, penalties), ARPU, LTV cohorts.
- Ops: utilization (rides/vehicle/day), median trip, unlock success, offline fleet %, task completion time, battery-swap frequency.
- Funnel: install→signup→KYC→card→first ride (from app analytics events); promo/campaign performance.
- Custom report builder: saved filters + scheduled CSV email (parity: reports; upgrade).

**Zones (map modification, parity all types)** — mapbox-gl-draw editor: draw/edit polygons per kind, rule fields per kind (bonus cents, fee, limit kmh, station capacity), versioning with diff view + activate/rollback, import/export GeoJSON, simulate point check tool.

**Pricing** — plans per city/model, dynamic pricing config with preview calendar, packages, subscriptions, add-ons, penalties catalogue.

**Marketing** — promo codes (parity), customer groups (rule builder: rides count, last active, city, debt), push campaigns (segment, schedule, preview device), email campaigns (Resend templates), loyalty config, POI manager, referral program config.

**Fleet maintenance** — task manager (create/assign/bulk from analytics), damage reports review (→ penalty flow), **Manage IoT**: device registry, add device (IMEI/ICCID/MSISDN → provisioning checklist), FOTA profile status, **IoT data log** (per-device merged telemetry+command timeline, hex frame viewer), scan data log, vehicle error log.

**Finance** — transaction history (all payments, filters, export), ledger explorer, debts dashboard (aging buckets), invoices, myDATA status, payouts reconciliation (Stripe balance vs ledger).

**Subscriptions/Add-ons content** — manage products, purchase history, FAQ editor.

**Team & accounts** — staff roles + permissions matrix, city scoping, **employee activity log** (audit_log viewer with entity filters), corporate accounts (members, limits, monthly invoices), subaccounts (city operators), **MDS + GBFS** feed config & keys.

**Settings** — system preferences (reservation TTL, min start battery, night hours, photo AI threshold, holds), vehicle models + battery curves editor, customer form builder, reaction test config, app localization (translations editor PL/EN/EL), map icons/personalization (app_content), tutorials editor, alerts & notifications rules (which alert → who/where: panel, push, Telegram).

## UX requirements

- Every table: server pagination, multi-sort, column picker, saved views, CSV export.
- Global search (cmd-k): user by phone, vehicle by code, trip by id.
- All destructive/money actions: confirm modal with reason field where mandated.
- Live map shared component with layers toggle (vehicles, alerts, zones, heatmap, tasks).
