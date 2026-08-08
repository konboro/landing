package protocol

import "testing"

func TestCRC16KnownVectors(t *testing.T) {
	cases := []struct {
		name string
		in   []byte
		want uint16
	}{
		// Canonical CRC-16/ARC (a.k.a. CRC-16/IBM) check value.
		{"check-string", []byte("123456789"), 0xBB3D},
		{"empty", []byte{}, 0x0000},
		{"single-A", []byte{'A'}, 0x30C0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := CRC16(c.in); got != c.want {
				t.Fatalf("CRC16(%q) = 0x%04X, want 0x%04X", c.in, got, c.want)
			}
		})
	}
}

// TestCRC16RoundTrip builds a real AVL frame and verifies the CRC embedded in it
// matches a fresh computation over the data field (codec-id..trailing count).
func TestCRC16RoundTrip(t *testing.T) {
	frame := BuildAVL([]Record{{
		TimestampMs: 1700000000000,
		Priority:    1,
		GPS:         GPS{LngE7: 237261000, LatE7: 379838000, Sats: 9},
		IO:          map[uint16]int64{239: 1, 66: 39500},
	}})
	// layout: [4B preamble][4B len][data...][4B crc]
	if len(frame) < 16 {
		t.Fatalf("frame too short: %d", len(frame))
	}
	dataLen := int(frame[4])<<24 | int(frame[5])<<16 | int(frame[6])<<8 | int(frame[7])
	data := frame[8 : 8+dataLen]
	crcField := frame[8+dataLen : 8+dataLen+4]
	gotCRC := uint16(crcField[2])<<8 | uint16(crcField[3])
	if want := CRC16(data); gotCRC != want {
		t.Fatalf("embedded CRC 0x%04X != computed 0x%04X", gotCRC, want)
	}
	// And the parser must accept it.
	if _, _, err := ParseAVL(frame); err != nil {
		t.Fatalf("ParseAVL rejected a self-built frame: %v", err)
	}
}
