# 20 — Testing & Stripe sandbox: what's set up right now

**Snapshot 2026-08-25.** Point-in-time status of the safe end-to-end testing
setup, so anyone can pick it up. Like `docs/19`, this goes stale — re-check the
live project if in doubt. **No real secrets in this file** (it's committed);
where a value is sensitive it says where it actually lives.

Project: **`pyferakmgtafifffqjat`** · branch **`feat/mydata-aade`**.

---

## 1. One-line summary

The full payment loop works end-to-end against the live backend using an
**isolated Stripe test Sandbox** — add card, trip capture, webhook, balanced
ledger, Greek myDATA receipt — and the rider app runs on a real Android phone.
**No real money can move**, and myDATA stays in `dry_run` (nothing transmitted).

## 2. Stripe: a fresh, isolated Sandbox (test mode)

- Penny is wired to a **new Stripe Sandbox**, deliberately separate from the
  live Atom account. Test mode only — real cards/customers are untouchable from
  it.
- The **live Atom account** is NOT connected here, with one intentional
  exception: the `mydata-shadow` webhook still listens to it for the shadow
  comparison (see `docs/19`). Do not repoint `mydata-shadow` at the sandbox.
- Keys/secrets live as **Supabase project secrets** (`STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`), never in git. The publishable key (public) is in
  each app's `.env.local`.
- The main webhook endpoint (`payments-webhook`) is created in the sandbox and
  **signature-verified** (proven live).

## 3. Test fixtures & the shared demo login

- **Rider** `test.rider@penny.rent` (phone `306941000001`): KYC approved, a
  sandbox card (••4242) on file, €100 wallet.
- **Staff** `owner@penny.rent`: owner role, used to sign into the admin panel.
  Its test password is **not** in git — (re)set it with the script in §5.

**Shared demo login (rider app), no SMS needed:**

| | |
|---|---|
| Phone | type **`6941000001`** after the pre-filled `+30 ` |
| Code  | **`123456`** |

This is a Supabase Auth *test OTP* (configured in `sms_test_otp`, valid to end
2027). Anyone with the APK logs in as `test.rider` with these. On-device you can
test **add card** and **wallet top-up** through the real Stripe PaymentSheet. A
full ride→charge needs a device unlock ACK (real hardware or the gateway sim),
so that part stays on the harness (§4).

## 4. End-to-end harness (no hardware)

Scripts in `scripts/`, run with the sandbox secret key + management token in env
(see each file's header for exact vars). They refuse non-test Stripe keys and
restore state after themselves.

| Script | What it does |
|---|---|
| `setup-sandbox-test.mjs` | Seeds the rider's sandbox customer + test card, points `STRIPE_SECRET_KEY` at the sandbox, sets the rider test password. |
| `setup-sandbox-webhook.mjs` | Creates the sandbox webhook endpoint, sets `STRIPE_WEBHOOK_SECRET`, and live-verifies delivery. |
| `e2e-trip-charge.mjs` | The proof: start → simulated unlock ACK (`trip_unlock_confirmed`) → end → off-session card capture → checks payment, ledger balance, myDATA receipt. Idempotent. |
| `set-staff-password.mjs` | Sets a known password on a staff account for panel sign-in. |

Last green run: trip charged **€1.15**, ledger summed to **0**, receipt **AA
23111** `pending`/`dry_run`, visible in the admin panel (Finance + myDATA).

## 5. Rider Android app — build & install

**Requirements:** Android SDK + Java (Android Studio), a phone with USB
debugging. Mapbox tokens in `apps/rider/.env.local` (gitignored):
`EXPO_PUBLIC_MAPBOX_TOKEN` (pk, public) and `MAPBOX_DOWNLOAD_TOKEN` (sk,
build-only).

```bash
cd apps/rider
# .env.local must exist (Supabase URL/anon, Stripe pk, Mapbox pk+sk)
npx expo prebuild -p android --no-install
pnpm apk            # → apps/rider/build/penny-rider-<ver>-arm.apk
adb install -r build/penny-rider-*.apk
```

The APK is debug-signed (fine for sideloading, not Play). Share the file with any
Android coworker; iPhone needs a separate iOS build. Login: §3.

### Windows gotchas (already solved — don't re-discover)

React Native's native toolchain breaks on two things here:

1. **A space in the project path** → Hermes/`hermesc` fails. The repo was moved
   from `D:\Dev\penny platform\landing` to **`D:\Dev\penny-platform\landing`**
   (space-free). Keep the checkout on a space-free path.
2. **A non-ASCII Windows username** (`micha\u015b`) → the native `prefab` step
   fails via the Gradle cache path. Build with **`GRADLE_USER_HOME=D:\gradle-home`**
   (an ASCII, space-free location off the user profile).

`build-apk.mjs` also quotes the `gradlew` path so a spaced path can't re-split.

## 6. What's NOT done (open follow-ups)

- Failure-path harness: declined card (`pm_card_chargeDeclined` → debt) and 3DS
  (`pm_card_authenticationRequired` → SCA).
- Reconcile 3 stale `processing` top-ups + 3 receipt-less payments (pre-existing).
- No `packages` configured yet (so `payments-buy-package` is untestable).
- iOS build; per-person accounts (needs a real SMS provider); real hardware /
  gateway sim for full in-app ride→charge.
- myDATA stays **`dry_run`** — do not switch to live filing (see `docs/18`/`19`).
