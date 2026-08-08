package protocol

import (
	"reflect"
	"testing"
)

func TestCodec8ERoundTrip(t *testing.T) {
	cases := []struct {
		name string
		recs []Record
	}{
		{
			name: "single record",
			recs: []Record{{
				TimestampMs: 1700000000000,
				Priority:    1,
				GPS:         GPS{LngE7: 237261000, LatE7: 379838000, Altitude: 120, Angle: 90, Sats: 9, Speed: 0},
				EventIOID:   239,
				IO:          map[uint16]int64{239: 1, 240: 0, 66: 39500, 67: 4000, 21: 4, 179: 1, 180: 0},
			}},
		},
		{
			name: "multi record with wide values",
			recs: []Record{
				{
					TimestampMs: 1700000001000,
					Priority:    2,
					GPS:         GPS{LngE7: 237261100, LatE7: 379838100, Altitude: 121, Angle: 91, Sats: 10, Speed: 15},
					EventIOID:   240,
					IO:          map[uint16]int64{240: 1, 66: 40000, 16: 1234567 /*odometer 4B*/, 200: 2},
				},
				{
					TimestampMs: 1700000002000,
					Priority:    1,
					GPS:         GPS{LngE7: -50000000, LatE7: 400000000, Altitude: -5, Angle: 359, Sats: 7, Speed: 42},
					EventIOID:   0,
					IO:          map[uint16]int64{17: -900 /*neg accel -> 8B*/, 18: 100, 19: 980},
				},
			},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			frame := BuildAVL(c.recs)
			got, count, err := ParseAVL(frame)
			if err != nil {
				t.Fatalf("ParseAVL: %v", err)
			}
			if int(count) != len(c.recs) {
				t.Fatalf("count = %d, want %d", count, len(c.recs))
			}
			if len(got) != len(c.recs) {
				t.Fatalf("got %d records, want %d", len(got), len(c.recs))
			}
			for i := range c.recs {
				w, g := c.recs[i], got[i]
				if w.TimestampMs != g.TimestampMs || w.Priority != g.Priority || w.EventIOID != g.EventIOID {
					t.Errorf("rec %d header mismatch: want %+v got %+v", i, w, g)
				}
				if w.GPS != g.GPS {
					t.Errorf("rec %d GPS mismatch: want %+v got %+v", i, w.GPS, g.GPS)
				}
				if !reflect.DeepEqual(w.IO, g.IO) {
					t.Errorf("rec %d IO mismatch: want %v got %v", i, w.IO, g.IO)
				}
			}
		})
	}
}

func TestParseAVLRejectsBadCRC(t *testing.T) {
	frame := BuildAVL([]Record{{TimestampMs: 1, GPS: GPS{}, IO: map[uint16]int64{}}})
	frame[len(frame)-1] ^= 0xFF // corrupt CRC
	if _, _, err := ParseAVL(frame); err == nil {
		t.Fatal("expected CRC error, got nil")
	}
}

func TestParseAVLShortBuffer(t *testing.T) {
	if _, _, err := ParseAVL([]byte{0, 0, 0, 0, 0, 0, 0, 10, 0x8E}); err != ErrShort {
		t.Fatalf("want ErrShort, got %v", err)
	}
}
