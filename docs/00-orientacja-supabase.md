# Penny.rent — orientacja w systemie (stan na 2026-08-14)

Dokument wejściowy dla nowej osoby (i jej agenta). Wszystko poniżej zweryfikowane
zapytaniami do **żywej** bazy, nie z pamięci. Gdzie coś jest niepewne, napisane
jest wprost.

Projekt Supabase: **`pyferakmgtafifffqjat`**
Repo: `konboro/landing`, gałąź robocza `fix/admin-missing-edge-fns`.

---

## 1. Co to jest i co realnie działa

Współdzielone hulajnogi (free-floating) w **Salonikach**. Zastępujemy Atom
Mobility własnym stackiem.

Stan produkcji **dziś**, dokładne zliczenia:

| co | ile |
|---|---|
| miasta | 1 (Thessaloniki) |
| strefy | 8, wszystkie aktywne |
| pojazdy | **1** — `PNY-1001` |
| urządzenia (modemy) | 2 (jeden aktywny, jeden zapasowy) |
| użytkownicy | 3 |
| konta personelu | 2 (obaj `owner`) |
| ramki telemetrii | ~2 550 |
| przejazdy | 8, **wszystkie `aborted`, żaden nigdy nie wystartował** |
| komendy do urządzeń | 105 |
| plany cenowe | 1 |

To nie jest demo z danymi zaseedowanymi — dane demonstracyjne zostały skasowane
10.08. Jeden skuter na liście to **prawdziwy, podłączony pojazd w Salonikach**.

---

## 2. Trzy warstwy

```
apps/rider   (Expo/RN)  ─┐
apps/ops     (Expo/RN)   ├─→  Supabase  ←─→  gateway (Go, VPS 209.38.236.159)  ←─ TCP :5027 ─→  FMB930 w skuterze
apps/admin   (Vite/React)┘      │
                                └─ Postgres + PostGIS + pgmq + RLS + Edge Functions (Deno)
```

Kluczowa zasada: **aplikacje nigdy nie piszą bezpośrednio do tabel pieniężnych
ani do odblokowania**. Wszystko, co dotyczy pieniędzy, zamka i stref, idzie przez
Edge Functions albo `SECURITY DEFINER` RPC. Odczyty idą kluczem `anon` przez RLS.

---

## 3. Ścieżka wynajmu — to trzeba zrozumieć najpierw

Najważniejszy przepływ w systemie. Numeracja odpowiada realnej kolejności.

1. **Klient widzi skuter** → widok `v_public_vehicles`.
   Pięć warunków naraz: `vehicles.status='available'`, `vehicles.visible`,
   `vehicle_state.pos is not null`, telemetria świeższa niż 15 min, oraz pozycja
   **wewnątrz aktywnej strefy `operating`**. Brak któregokolwiek = pojazdu nie ma
   na mapie. Najczęstsza przyczyna „skuter zniknął" to strefa albo pozycja.

2. **Klient naciska odblokuj** → Edge Function **`trips-start`**.
   Sprawdza 14 bramek po kolei: konto aktywne, KYC `approved`, brak długów, brak
   trwającego przejazdu, pojazd istnieje/dostępny/online, świeżość telemetrii
   (`app_config.max_telemetry_age_s`, dziś 600 s), poziom baterii
   (`app_config.min_start_soc`, dziś 15), prawo jazdy jeśli model wymaga,
   pozycja klienta w strefie **lub** ≤150 m od pojazdu, sposób płatności
   (karta / saldo / pakiet), istnienie cennika.
   Efekt: wiersz w `trips` ze statusem `unlocking`, wiersz w `commands`,
   `vehicles.status='in_trip'`, oraz `enqueue_vehicle_command()` → kolejka
   **pgmq `commands`**.

3. **Gateway odbiera komendę** z pgmq, dociąga jej treść z tabeli `commands`
   (wiadomość w kolejce zawiera **tylko `command_id`**), rozwiązuje urządzenie po
   `devices.vehicle_id` **i `devices.status='active'`**, wysyła Codec 12 po
   otwartym TCP.

4. **Urządzenie potwierdza** odpowiedzią Codec 12 (~1 s).

5. **Gateway startuje przejazd** → RPC **`trip_unlock_confirmed(uuid)`**:
   `trips.status='active'` + stempel `started_at`. Działa wyłącznie na przejeździe
   w stanie `unlocking`, więc spóźnione potwierdzenie nic nie wskrzesi.

6. **Gdy potwierdzenia nie ma** → cron `sweep-stuck-unlocks` (co minutę) wywołuje
   `sweep_stuck_unlocks(60)`: przejazd → `aborted`, pojazd → `available`,
   niedostarczona komenda → `expired`. To jest siatka bezpieczeństwa: bez niej
   każda nieudana próba **trwale** usuwała skuter z floty.

**Uwaga projektowa:** przejazd startuje na potwierdzeniu Codec 12, a **nie** na
DIN1. DIN1 (element AVL `1`) mówi „skuter faktycznie się odpalił", ale przychodzi
dopiero z kolejnym rekordem telemetrii — przy obecnej konfiguracji nawet 5 minut
później. Czekanie na niego oznaczałoby komunikat o porażce dla klienta stojącego
przy otwartym skuterze. DIN1 jest **weryfikacją** startu, nie jego warunkiem.

---

## 4. Supabase — gdzie co leży

### 4.1 Tabele (~78). Grupy, które mają znaczenie

**Flota i IoT**
`vehicles` · `vehicle_models` · `vehicle_state` (jeden gorący wiersz na pojazd:
pozycja, SoC, prędkość, zapłon, zamek, `session_online`, `last_seen`) ·
`devices` (IMEI, SIM, `status`, `vehicle_id`) · `telemetry` (**partycjonowana
miesięcznie**: `telemetry_2026_08`, `_09`, `_10`, `telemetry_default`) ·
`commands` · `vehicle_alerts` · `vehicle_status_log` · `vehicle_notes` ·
`battery_swaps` · `maintenance_log` · `damage_reports`

**Przejazdy** — `trips` · `trip_events` (**append-only, wyzwalacz blokuje UPDATE
i DELETE**) · `trip_routes` · `ride_reviews`

**Pieniądze** — `payments` · `ledger_accounts` · `ledger_entries` (podwójny zapis,
wyzwalacz `ledger_txn_balanced` pilnuje bilansu) · `debts` · `invoices` ·
`payment_methods` · `stripe_customers` · `stripe_events` · `packages` ·
`package_purchases` · `subscriptions` · `user_subscriptions` · `addons` ·
`addon_purchases` · `promo_codes` · `promo_redemptions`

**Ludzie** — `users` · `staff` · `role_permissions` · `user_documents` ·
`sumsub_applicants` / `_documents` / `_review_history` · `onboarding_progress` ·
`customer_groups` · `customer_forms` · `corporate_accounts` / `_members` ·
`loyalty_accounts` / `_events` / `loyalty_tiers` · `referrals`

**Geografia** — `cities` · `zones` · `zone_versions` (**snapshot pełnej geometrii
każdej wersji — to jest nasza kopia zapasowa stref, uratowała nas 11.08**) · `pois`

**Operacje i komunikacja** — `ops_tasks` · `ops_shifts` · `scan_data_log` ·
`inbox_messages` · `notification_rules` · `notification_log` · `push_tokens` ·
`push_campaigns` · `broadcasts` · `email_campaigns` · `faq_items` ·
`app_content` · `translations`

**Konfiguracja** — `app_config` (klucz→wartość; m.in. `min_start_soc`,
`max_telemetry_age_s`) · `pricing_plans` · `penalties` · `battery_curves` ·
`audit_log` · `sims` / `sim_events` / `sim_usage_daily`

RLS jest **włączony na wszystkich** tabelach publicznych.

### 4.2 Widoki (31). Te, których się faktycznie używa

| widok | do czego |
|---|---|
| `v_public_vehicles` | **mapa klienta** — pięć bramek opisanych w §3 |
| `v_my_wallet_balance` | saldo **zalogowanego** (filtruje po `auth.uid()`) |
| `v_user_wallet_balance` | saldo dowolnego użytkownika — dla serwera/panelu |
| `v_vehicle_io` | linie cyfrowe DIN1/DOUT1/DOUT2 z ramek |
| `v_admin_kpis`, `v_admin_rides`, `v_admin_vehicles`, `v_admin_customers` | panel |
| `v_user_profile_full`, `v_user_ride_history`, `v_user_timeline`, `v_user_stats` | karta klienta |
| `v_vehicle_ride_history`, `v_vehicle_timeline`, `v_vehicle_stats`, `v_vehicle_error_log` | karta pojazdu |
| `v_heatmap_starts` / `_ends` / `_idle` | mapy ciepła |
| `v_ledger_account_balances`, `v_transaction_history` | księgowość |
| `v_sim_inventory`, `v_sim_usage_30d`, `v_sim_alerts`, `v_sim_cost_summary` | karty SIM |
| `v_ride_verification_queue` | kolejka weryfikacji zdjęć |

**Pułapka, która kosztowała nas kilka godzin:** widok `v_wallet_balance` **nie
istnieje**. Aplikacja go odpytywała, PostgREST zwracał 404, kod połykał błąd i
pokazywał saldo 0, podczas gdy w księdze leżało 60 €. Prawidłowe nazwy są dwie,
wyżej w tabeli.

### 4.3 Funkcje RPC (poza PostGIS)

| funkcja | tryb | kto może wołać | rola |
|---|---|---|---|
| `vehicle_snapshot(code)` | definer | anon, zalogowany, gateway | stan pojazdu dla `trips-start` |
| `zones_at_point(lng,lat,city)` | definer | anon, zalogowany, gateway | w jakich strefach jest punkt |
| `trip_transition(trip,to,actor,meta)` | definer | anon, zalogowany, gateway | zmiana statusu + wpis do `trip_events` |
| `trip_unlock_confirmed(trip)` | definer | **tylko gateway** | start przejazdu po potwierdzeniu |
| `sweep_stuck_unlocks(sekundy)` | definer | **tylko service_role/cron** | siatka bezpieczeństwa |
| `enqueue_vehicle_command(id)` | definer | **tylko service_role** | wrzuca `{command_id}` do pgmq |
| `apply_zone_version(city,zones,reason,by)` | definer | anon, zalogowany, gateway | zapis nowej wersji stref |
| `post_ledger(...)` | definer | anon, zalogowany | księgowanie podwójnego zapisu |
| `is_staff`, `is_ops_in_city`, `can_read_vehicle` | definer | wszyscy | pomocnicze do RLS |
| `mask_phone`, `mask_doc_number` | invoker | wszyscy | maskowanie danych |

### 4.4 Edge Functions — 37, wszystkie ACTIVE

- **Przejazdy:** `trips-start` (v5) · `trips-end` · `trips-pause` · `trips-reserve`
- **Płatności:** `payments-setup-intent` · `payments-topup` (nowa) ·
  `payments-cards` (nowa: `sync` / `set_default` / `remove`) ·
  `payments-buy-package` · `payments-pay-debt` · `payments-webhook`
- **IoT:** `vehicle-command` · `vehicle-status` · `gbfs`
- **Panel (17):** `admin-me`, `admin-panel-data`, `admin-list`, `admin-write`,
  `admin-charge`, `admin-refund`, `admin-credit-wallet`, `admin-block-user`,
  `admin-broadcast`, `admin-messages`, `admin-user-profile`,
  `admin-vehicle-create` / `-delete` / `-history`, `admin-app-config`,
  `admin-sim-detail`
- **Pozostałe:** `zones-save` · `photo-review` · `photo-review-decision` ·
  `damage-report` · `sumsub-applicant` · `sumsub-webhook` · `sim-command` · `sim-sync`

Wdrożenie: `node scripts/deploy-functions.mjs --project-ref pyferakmgtafifffqjat --only <slug>`
(potrzebny `SUPABASE_ACCESS_TOKEN`). Bez JWT działają tylko `payments-webhook`,
`sumsub-webhook`, `gbfs` — reszta wymaga tokenu użytkownika.

### 4.5 Cron

Jedno zadanie: **`sweep-stuck-unlocks`**, co minutę. Opisane w §3 punkt 6.

### 4.6 Kolejka

Rozszerzenie **pgmq**, kolejka **`commands`**. Wiadomość zawiera **wyłącznie
`{"command_id": "..."}"`** — gateway dociąga resztę z tabeli `commands`. Nie
kopiuj tam treści komendy: stan wiersza może się zmienić między zakolejkowaniem
a odczytem (np. wygaśnięciem), a wtedy działałbyś na nieaktualnym zdjęciu.

---

## 5. Gateway (Go) — poza Supabase

Repo: `services/gateway`. Serwer: **`209.38.236.159`**, usługa systemd
**`penny-gateway`**, port TCP **5027**, źródła na VPS w `/opt/penny/gateway`,
binarka `/usr/local/bin/penny-gateway`, konfiguracja `/etc/penny/gateway.env`.

Łączy się do bazy **osobną rolą `penny_gateway`** o minimalnych uprawnieniach:
`SELECT`/`UPDATE` na `commands`, zapis telemetrii i `vehicle_state`, `EXECUTE` na
`trip_unlock_confirmed`. **Nie ma `UPDATE` na `trips`** — dlatego start przejazdu
idzie przez RPC.

Co robi: handshake IMEI → przyjmuje ramki Codec 8E → potwierdza je → zapisuje
telemetrię i `vehicle_state` → wysyła komendy Codec 12 → melduje wynik.

Budowanie i wdrożenie (Go jest tylko na VPS-ie, nie lokalnie):
```
scp services/gateway/internal/... root@209.38.236.159:/opt/penny/gateway/internal/...
ssh root@209.38.236.159 'cd /opt/penny/gateway && export PATH=$PATH:/usr/local/go/bin \
  && go build ./... && go test ./... \
  && go build -o /tmp/penny-gateway ./cmd/gateway \
  && systemctl stop penny-gateway && install -m 0755 /tmp/penny-gateway /usr/local/bin/penny-gateway \
  && systemctl start penny-gateway'
```

### Urządzenie
Teltonika **FMB930**, IMEI **354002392604318**, firmware `03.29.00.Rev.932`,
APN `iot.truphone.com`, serwer i port wpisane poprawnie (`getparam 2004/2005`).
Parametr `1000` = `259200` (maksimum) — modem **trzyma łącze otwarte na stałe**.
Sleep mode (`102`) = 0, czyli wyłączony.

Mapowanie wyjść (potwierdzone przez właściciela i w praktyce):
`DOUT1` = zasilanie/odpalenie · `DIN1` = potwierdzenie, że skuter jest włączony ·
`DOUT2` = syrena.

---

## 6. Pułapki, które już nas kosztowały (nie powtarzać)

1. **Keepalive to pojedynczy bajt `0xFF`.** Czytnik ramek brał go za fragment
   4-bajtowego pola długości i zrywał połączenie — 7 rozłączeń w jedno
   popołudnie, każde odblokowanie trafiało w zamknięte gniazdo. Ping bywa wysyłany
   raz lub kilka razy pod rząd, więc trzeba go zdejmować **bajt po bajcie**.
2. **Ramka bez fixa GPS raportuje `0,0`.** Nadpisywanie tym ostatniej znanej
   pozycji wyrzucało pojazd poza strefę i z mapy. ~10 ramek na 390. Teraz
   `HasFix=false` → `COALESCE` zachowuje starą pozycję.
3. **FMB930 nie widzi akumulatora trakcyjnego.** Napięcie zewnętrzne to szyna 5 V,
   a element `113` (100%) to bateryjka podtrzymująca modemu. **SoC jest dziś
   wartością ustawianą ręcznie przez operatora** i musi przetrwać kolejne ramki.
4. **Połykane błędy.** Trzy osobne awarie tego samego typu w jeden dzień:
   nieudana archiwizacja pgmq, nieudany zapis statusu komendy (`status` wiązany
   jako tekst do kolumny typu enum — potrzebne rzutowania), nadpisywany SoC.
   Wszystkie „działały" w metrykach i nie działały w bazie. **Nie pisz
   `_ = f()` na ścieżkach zapisu.**
5. **`devices.status` musi być `active`.** Zarówno `vehicle_snapshot`, jak i
   dyspozytor komend robią join `and d.status='active'`. Modem w statusie `bench`
   = puste `device_id` i komendy, które nigdy nie dochodzą.
6. **Strefy da się skasować i nic tego nie zgłosi.** Pusta tabela `zones` =
   cała flota znika z aplikacji, przy nietkniętych danych pojazdów. Odzysk:
   `zone_versions.payload` zawiera pełną geometrię — jedno zapytanie
   `st_geomfromgeojson` przywraca komplet.

---

## 7. Otwarte ryzyka

- **`trip_transition` i `apply_zone_version` są wołalne przez `anon`.** Pierwsza
  pozwala przestawiać statusy przejazdów, druga przepisywać strefy — obie z
  poziomu klucza publicznego. Do zamknięcia przed startem.
- **Strefa `TEST - Wroclaw (USUN PO TESTACH)`** jest aktywną strefą operacyjną
  przypiętą do Salonik. Istnieje po to, żeby dało się testować z Polski.
  **Musi zniknąć przed produkcją.**
- **Bramki decku/uprawnień w aplikacji są klienckie** w kilku miejscach — serwer
  nie zna wszystkich reguł.
- **DIN1 i DOUT1 nie są w zestawie elementów AVL.** Warto włączyć w Configuratorze
  (`179` oraz `1` jako element zdarzeniowy „on change"), wtedy potwierdzenie
  odpalenia skraca się z minut do sekundy, a wykrywanie upadku w ogóle zacznie
  działać.
- **Żaden przejazd nie przeszedł jeszcze pełnej ścieżki.** Poprawka startująca
  przejazd została wdrożona 10.08 o 21:04, a wszystkie 8 istniejących prób jest
  wcześniejszych. Pierwszy udany wynajem jest **nadal do potwierdzenia**.

---

## 8. Praktyczne polecenia

```bash
pnpm typecheck                      # bramka jakości całego monorepo
pnpm --filter @penny/rider start    # Metro dla aplikacji klienta
pnpm --filter @penny/admin dev      # panel na localhost
```

SQL na żywej bazie: Management API `/database/query` z tokenem PAT.
Odczyty można też przez MCP Supabase (jest **tylko do odczytu**).

Telefon (dev client, wczytuje kod z Metro):
```bash
adb reverse tcp:8081 tcp:8081
adb shell am force-stop com.pennyrent.rider
adb shell am start -a android.intent.action.VIEW -d "penny://expo-development-client/?url=http://localhost:8081"
```
Jeśli zmiany w kodzie nie wchodzą — sprawdź `adb shell dumpsys package
com.pennyrent.rider | grep flags`. Brak `DEBUGGABLE` oznacza build **release z
wbudowanym JS**, który Metro całkowicie ignoruje; wtedy trzeba przeinstalować
wersję debug.
