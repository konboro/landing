package store

import (
	"context"
	"encoding/json"
	"fmt"
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
	rows := make([][]any, 0, len(batch))
	for _, t := range batch {
		ioJSON, _ := json.Marshal(ioStringKeys(t.IO))
		rows = append(rows, []any{
			nullStr(t.DeviceID), nullStr(t.VehicleID), t.DeviceTs, t.ServerTs,
			t.Lng, t.Lat, t.SpeedKmh, t.Heading, t.Altitude, t.Sats,
			t.ExtVoltageMv, t.BattVoltageMv, t.Din1, t.Dout1, t.Dout2,
			t.GSMSignal, ioJSON,
		})
	}
	_, err := s.pool.CopyFrom(ctx,
		pgx.Identifier{"telemetry"},
		[]string{"device_id", "vehicle_id", "device_ts", "server_ts",
			"pos_lng", "pos_lat", "speed_kmh", "heading", "altitude", "sats",
			"ext_voltage_mv", "batt_voltage_mv", "din1", "dout1", "dout2",
			"gsm_signal", "io"},
		pgx.CopyFromRows(rows))
	return err
}

func (s *PGStore) UpsertVehicleState(ctx context.Context, st VehicleState) error {
	const q = `
INSERT INTO vehicle_state
 (vehicle_id, pos_lng, pos_lat, soc_pct, speed_kmh, ignition, locked,
  last_seen, session_online, fall, power_cut, moved_while_locked)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
ON CONFLICT (vehicle_id) DO UPDATE SET
  pos_lng=EXCLUDED.pos_lng, pos_lat=EXCLUDED.pos_lat, soc_pct=EXCLUDED.soc_pct,
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
type pgmqPayload struct {
	CommandID string            `json:"command_id"`
	VehicleID string            `json:"vehicle_id"`
	Kind      string            `json:"cmd"`
	Payload   map[string]string `json:"payload"`
	TripID    string            `json:"trip_id"`
}

func (s *PGStore) NextCommand(ctx context.Context) (Command, bool, error) {
	// pgmq.read(queue, vt_seconds, qty) -> set of (msg_id, read_ct, ..., message)
	const q = `SELECT msg_id, message FROM pgmq.read($1, 30, 1)`
	var msgID int64
	var msg []byte
	err := s.pool.QueryRow(ctx, q, s.queue).Scan(&msgID, &msg)
	if err == pgx.ErrNoRows {
		return Command{}, false, nil
	}
	if err != nil {
		return Command{}, false, err
	}
	var p pgmqPayload
	if err := json.Unmarshal(msg, &p); err != nil {
		return Command{}, false, fmt.Errorf("bad pgmq payload: %w", err)
	}
	// Resolve device (IMEI + id) from vehicle.
	const dq = `SELECT id::text, imei FROM devices WHERE vehicle_id = $1 AND status='active' LIMIT 1`
	var devID, imei string
	if err := s.pool.QueryRow(ctx, dq, p.VehicleID).Scan(&devID, &imei); err != nil {
		return Command{}, false, fmt.Errorf("resolve device for vehicle %s: %w", p.VehicleID, err)
	}
	// Archive the pgmq message; the commands table row is the durable record.
	_, _ = s.pool.Exec(ctx, `SELECT pgmq.archive($1, $2)`, s.queue, msgID)

	return Command{
		ID:        p.CommandID,
		VehicleID: p.VehicleID,
		DeviceID:  devID,
		IMEI:      imei,
		Kind:      p.Kind,
		Payload:   p.Payload,
		Channel:   "gprs",
		TripID:    p.TripID,
		QueuedAt:  time.Now().UTC(),
	}, true, nil
}

func (s *PGStore) MarkCommand(ctx context.Context, id, status, channel, errText string) error {
	// Only advance status; never regress an acked/expired command. Idempotent by id.
	const q = `
UPDATE commands SET
  status = $2,
  channel = COALESCE(NULLIF($3,''), channel),
  error = NULLIF($4,''),
  sent_at = CASE WHEN $2='sent' AND sent_at IS NULL THEN now() ELSE sent_at END,
  acked_at = CASE WHEN $2='acked' THEN now() ELSE acked_at END
WHERE id = $1
  AND status <> 'acked' AND status <> 'expired'`
	_, err := s.pool.Exec(ctx, q, id, status, channel, errText)
	return err
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
