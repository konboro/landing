# Runbook: stuck trip (no lock ACK at end)

**Trigger:** trip in `ending` > 60 s (alert `stuck_trip`, Telegram + panel banner).

The rider tried to end but the vehicle never ACKed the `lock` command. Per Hard
Rule #1 and docs/04 end-flow step 4, the rider is **not billed for the stuck
time** and must not be blamed.

## Do this

1. Open Admin → Rides → the trip. Confirm status `ending`.
2. Vehicle detail → IoT session log: is the device online?
   - **Online:** command console → re-send `lock`. Watch for DOUT1 state change
     in next AVL record. If it locks, the edge fn finalizes the trip.
   - **Offline (2G drop):** the gateway will retry + SMS-fallback the lock
     automatically. Wait one telemetry interval (≤120 s on-stop). If still
     offline > 5 min, dispatch ops to the vehicle position.
3. If the vehicle is confirmed parked but unreachable, use **admin end-trip
   override** (reason mandatory → audit_log). Bill from `pricing_snapshot` up to
   the rider's end request timestamp, not "now".
4. If repeated on the same vehicle (≥3/24 h), flag `maintenance?` and open an
   inspect task.

## Never

- Never charge for time after the rider pressed end.
- Never mark `charged` without a lock ACK **or** an explicit admin override with
  reason.
