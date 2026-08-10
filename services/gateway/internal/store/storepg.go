package store

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PGStore is the production Store backed by Postgres (Supabase) with pgmq for
// the command queue. It is intentionally thin; all business rules live in the
// core packages.
type PGStore struct {
	pool  *pgxpool.Pool
	queue string // pgmq queue name
}

// NewPG connects to Postgres and returns a PGStore reading commands from the
// given pgmq queue.
func NewPG(ctx context.Context, url, queue string) (*PGStore, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &PGStore{pool: pool, queue: queue}, nil
}

// Close releases the connection pool.
func (s *PGStore) Close() { s.pool.Close() }

func (s *PGStore) DeviceByIMEI(ctx context.Context, imei string) (Device, error) {
	const q = `
SELECT id::text, imei, COALESCE(vehicle_id::text,''), model::text,
       COALESCE(phone_number,''), COALESCE(sms_login,''), COALESCE(sms_pass,''),
       status::text
FROM devices WHERE imei = $1`
	var d Device
	err := s.pool.QueryRow(ctx, q, imei).Scan(
		&d.ID, &d.IMEI, &d.VehicleID, &d.Model,
		&d.PhoneNumber, &d.SMSLogin, &d.SMSPass, &d.Status)
	if err == pgx.ErrNoRows {
		return Device{}, ErrNotFound{IMEI: imei}
	}
	if err != nil {
		return Device{}, err
	}
	return d, nil
}

func (s *PGStore) InsertTelemetry(ctx context.Context, batch []Telemetry) error {
	if len(batch) == 0 {
		return nil
	}
	// `telemetry.pos` is a PostGIS geometry(Point,4326), not a pair of float
	// columns. This used to CopyFrom into `pos_lng` / `pos_lat`, which do not
	// exist — every ingest failed with 42703 and no telemetry was ever stored.
	// Binary COPY cannot build a geometry, so the point is made in SQL.
	//
	// A batch is one AVL packet (a handful of records), so pipelining the
	// inserts costs nothing next to the round trip that delivered them.
	const q = `
INSERT INTO telemetry
 (device_id, vehicle_id, device_ts, server_ts, pos, speed_kmh, heading,
  altitude, sats, ext_voltage_mv, batt_voltage_mv, din1, dout1, dout2,
  gsm_signal, io)
VALUES ($1,$2,$3,$4, st_setsrid(st_point($5,$6),4326), $7,$8,$9,$10,$11,$12,
        $13,$14,$15,$16,$17)`

	b := &pgx.Batch{}
	for _, t := range batch {
		ioJSON, _ := json.Marshal(ioStringKeys(t.IO))
		b.Queue(q,
			nullStr(t.DeviceID), nullStr(t.VehicleID), t.DeviceTs, t.ServerTs,
			t.Lng, t.Lat, t.SpeedKmh, t.Heading, t.Altitude, t.Sats,
			t.ExtVoltageMv, t.BattVoltageMv, t.Din1, t.Dout1, t.Dout2,
			t.GSMSignal, ioJSON,
		)
	}
	res := s.pool.SendBatch(ctx, b)
	defer res.Close()
	for range batch {
		if _, err := res.Exec(); err != nil {
			return err
		}
	}
	return nil
}

func (s *PGStore) UpsertVehicleState(ctx context.Context, st VehicleState) error {
	// Same geometry mismatch as telemetry: `vehicle_state.pos` is a PostGIS
	// point. It is what `v_public_vehicles` reads with st_x/st_y to feed the
	// rider map, so the column stays and the gateway builds the point.
	const q = `
INSERT INTO vehicle_state
 (vehicle_id, pos, soc_pct, speed_kmh, ignition, locked,
  last_seen, session_online, fall, power_cut, moved_while_locked)
VALUES ($1, st_setsrid(st_point($2,$3),4326), $4,$5,$6,$7,$8,$9,$10,$11,$12)
ON CONFLICT (vehicle_id) DO UPDATE SET
  pos=EXCLUDED.pos,
  -- Keep the last known charge when the frame carries no reading. The FMB930
  -- never sees the traction pack, so overwriting unconditionally would reset SoC
  -- on every frame and leave the vehicle permanently under min_start_soc.
  soc_pct=COALESCE(EXCLUDED.soc_pct, vehicle_state.soc_pct),
  speed_kmh=EXCLUDED.speed_kmh, ignition=EXCLUDED.ignition, locked=EXCLUDED.locked,
  last_seen=EXCLUDED.last_seen, session_online=EXCLUDED.session_online,
  fall=EXCLUDED.fall, power_cut=EXCLUDED.power_cut,
  moved_while_locked=EXCLUDED.moved_while_locked`
	_, err := s.pool.Exec(ctx, q,
		st.VehicleID, st.Lng, st.Lat, st.SoCPct, st.SpeedKmh, st.Ignition, st.Locked,
		st.LastSeen, st.SessionOnline, st.Fall, st.PowerCut, st.MovedWhileLocked)
	return err
}

func (s *PGStore) InsertAlert(ctx context.Context, a Alert) error {
	payload, _ := json.Marshal(a.Payload)
	const q = `INSERT INTO vehicle_alerts (vehicle_id, kind, payload) VALUES ($1,$2,$3)`
	_, err := s.pool.Exec(ctx, q, a.VehicleID, a.Kind, payload)
	return err
}

// pgmqMessage is the shape pgmq.read returns in its message jsonb.
// pgmqPayload is what enqueue_vehicle_command actually writes: a pointer to the
// commands row, nothing more. It deliberately carries no command detail — the
// row is the durable record and can change (expire, get cancelled) between being
// queued and being read, so copying its fields into the message would let the
// gateway act on a stale snapshot.
type pgmqPayload struct {
	CommandID string `json:"command_id"`
}

func (s *PGStore) MarkVehicleOffline(ctx context.Context, vehicleID string) error {
	// last_seen is deliberately left alone: it records when the vehicle last
	// spoke, which stays true after it goes away and is what the staleness checks
	// read.
	const q = `UPDATE vehicle_state SET session_online = false WHERE vehicle_id = $1`
	_, err := s.pool.Exec(ctx, q, vehicleID)
	return err
}

// maxCommandReads bounds how often one queue message may come back before it is
// dropped. Nothing in pgmq does this for us: a message whose handling fails is
// simply redelivered after the visibility timeout, forever. A real one reached
// read_ct 141 in about seventy minutes.
const maxCommandReads = 5

func (s *PGStore) NextCommand(ctx context.Context) (Command, bool, error) {
	// pgmq.read(queue, vt_seconds, qty) -> set of (msg_id, read_ct, ..., message)
	const q = `SELECT msg_id, read_ct, message FROM pgmq.read($1, 30, 1)`
	var msgID int64
	var readCt int
	var msg []byte
	err := s.pool.QueryRow(ctx, q, s.queue).Scan(&msgID, &readCt, &msg)
	if err == pgx.ErrNoRows {
		return Command{}, false, nil
	}
	if err != nil {
		return Command{}, false, err
	}

	// Take the message off the queue whatever happens below. Every failure here is
	// permanent for this message — a malformed payload, a command that no longer
	// exists, a vehicle with no active device — so redelivering it only produces
	// the same error on a loop.
	// A failed archive used to be swallowed, which is how a message could be read
	// 151 times: the handler "gave up" but the message never left the queue, so it
	// came back every visibility timeout forever. If archiving fails, delete —
	// and if that fails too, say so, because the loop is otherwise invisible.
	archive := func() {
		if _, err := s.pool.Exec(ctx, `SELECT pgmq.archive($1, $2::bigint)`, s.queue, msgID); err != nil {
			log.Printf("[commands] archive msg %d failed (%v) — deleting instead", msgID, err)
			if _, derr := s.pool.Exec(ctx, `SELECT pgmq.delete($1, $2::bigint)`, s.queue, msgID); derr != nil {
				log.Printf("[commands] delete msg %d ALSO failed: %v — message will be retried", msgID, derr)
			}
		}
	}

	if readCt > maxCommandReads {
		archive()
		return Command{}, false, fmt.Errorf("dropping command message %d after %d attempts", msgID, readCt)
	}

	var p pgmqPayload
	if err := json.Unmarshal(msg, &p); err != nil {
		archive()
		return Command{}, false, fmt.Errorf("bad pgmq payload: %w", err)
	}
	if p.CommandID == "" {
		archive()
		return Command{}, false, fmt.Errorf("pgmq message %d has no command_id", msgID)
	}

	// The commands row is authoritative, not the message. enqueue_vehicle_command
	// sends only {"command_id": ...} — reading vehicle/kind/payload straight off
	// the message produced empty values and a permanent retry loop.
	const cq = `
SELECT vehicle_id::text, kind::text, COALESCE(payload,'{}'::jsonb)::text,
       COALESCE(trip_id::text,''), status::text
  FROM commands WHERE id = $1`
	var vehicleID, kind, payloadJSON, tripID, status string
	if err := s.pool.QueryRow(ctx, cq, p.CommandID).Scan(
		&vehicleID, &kind, &payloadJSON, &tripID, &status,
	); err != nil {
		archive()
		if err == pgx.ErrNoRows {
			return Command{}, false, fmt.Errorf("command %s no longer exists", p.CommandID)
		}
		return Command{}, false, fmt.Errorf("load command %s: %w", p.CommandID, err)
	}

	// Only deliver what is still waiting. A command that was expired or already
	// sent must never reach the vehicle late: unlock is a physical action, and
	// firing an hour-old one powers on a scooter nobody is standing next to.
	if status != "queued" {
		archive()
		return Command{}, false, nil
	}

	var payload map[string]string
	if err := json.Unmarshal([]byte(payloadJSON), &payload); err != nil {
		payload = map[string]string{}
	}

	const dq = `SELECT id::text, imei FROM devices WHERE vehicle_id = $1 AND status='active' LIMIT 1`
	var devID, imei string
	if err := s.pool.QueryRow(ctx, dq, vehicleID).Scan(&devID, &imei); err != nil {
		archive()
		// Record why on the command itself, so this surfaces in the panel instead
		// of only in the gateway log.
		_ = s.MarkCommand(ctx, p.CommandID, "failed", "", "no active device for vehicle")
		return Command{}, false, fmt.Errorf("resolve device for vehicle %s: %w", vehicleID, err)
	}

	archive()

	return Command{
		ID:        p.CommandID,
		VehicleID: vehicleID,
		DeviceID:  devID,
		IMEI:      imei,
		Kind:      kind,
		Payload:   payload,
		Channel:   "gprs",
		TripID:    tripID,
		QueuedAt:  time.Now().UTC(),
	}, true, nil
}

func (s *PGStore) MarkCommand(ctx context.Context, id, status, channel, errText string) error {
	// Only advance status; never regress an acked/expired command. Idempotent by id.
	//
	// `status` and `channel` are enum columns, so the bound parameters need an
	// explicit cast — and `id` is a uuid. Without the casts this statement failed
	// on every call, and because every caller discards the error with `_ =`, the
	// failure was invisible: the gateway reported "sent"/"acked" in its metrics
	// while the commands table sat at 'queued' forever. Observed on the first real
	// unlock — the gateway logged the failure, called MarkCommand, and the row
	// never moved.
	const q = `
UPDATE commands SET
  status = $2::command_status,
  channel = COALESCE(NULLIF($3,'')::command_channel, channel),
  error = NULLIF($4,''),
  sent_at = CASE WHEN $2='sent' AND sent_at IS NULL THEN now() ELSE sent_at END,
  acked_at = CASE WHEN $2='acked' THEN now() ELSE acked_at END
WHERE id = $1::uuid
  AND status <> 'acked' AND status <> 'expired'`
	tag, err := s.pool.Exec(ctx, q, id, status, channel, errText)
	if err != nil {
		// Never silent: a command whose status cannot be written looks queued
		// forever, which is exactly how a stuck unlock hides.
		log.Printf("[store] MarkCommand %s -> %s failed: %v", id, status, err)
		return err
	}
	if tag.RowsAffected() == 0 {
		log.Printf("[store] MarkCommand %s -> %s matched no row (already terminal?)", id, status)
	}
	return nil
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func ioStringKeys(io map[uint16]int64) map[string]int64 {
	out := make(map[string]int64, len(io))
	for k, v := range io {
		out[strconv.Itoa(int(k))] = v
	}
	return out
}
