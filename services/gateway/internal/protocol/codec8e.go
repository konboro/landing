package protocol

import (
	"encoding/binary"
	"errors"
	"fmt"
)

// CodecID values.
const (
	Codec8Extended = 0x8E
	Codec12        = 0x0C
)

var (
	// ErrShort means the buffer ended before a full frame was available.
	ErrShort = errors.New("protocol: short buffer")
	// ErrPreamble means the 4-byte zero preamble was not present.
	ErrPreamble = errors.New("protocol: bad preamble")
	// ErrCodec means the codec id did not match the expected value.
	ErrCodec = errors.New("protocol: unexpected codec id")
	// ErrCount means the leading and trailing record counts disagreed.
	ErrCount = errors.New("protocol: record count mismatch")
	// ErrCRC means the trailing CRC did not match the computed value.
	ErrCRC = errors.New("protocol: crc mismatch")
	// ErrLength means the declared data field length was inconsistent.
	ErrLength = errors.New("protocol: bad data length")
)

// GPS holds the fixed GPS element of an AVL record. Longitude and latitude are
// stored as the raw Teltonika int32 (degrees * 1e7); use Lng()/Lat() for float.
type GPS struct {
	LngE7    int32
	LatE7    int32
	Altitude int16
	Angle    uint16
	Sats     uint8
	Speed    uint16
}

// Lng returns longitude in decimal degrees.
func (g GPS) Lng() float64 { return float64(g.LngE7) / 1e7 }

// Lat returns latitude in decimal degrees.
func (g GPS) Lat() float64 { return float64(g.LatE7) / 1e7 }

// Record is one AVL data record from a Codec 8E packet. IO holds every IO
// element keyed by its AVL id; values are widened to int64 regardless of the
// on-wire width so the ingest layer can capture unknown ids into jsonb.
type Record struct {
	TimestampMs uint64
	Priority    uint8
	GPS         GPS
	EventIOID   uint16
	IO          map[uint16]int64
}

// ParseAVL parses a full Codec 8 Extended AVL packet. It returns the records and
// the record count that must be echoed back in the ACK. The whole frame must be
// present in buf; use FrameLength to check for completeness on a stream first.
func ParseAVL(buf []byte) (recs []Record, count uint8, err error) {
	if len(buf) < 12 {
		return nil, 0, ErrShort
	}
	if binary.BigEndian.Uint32(buf[0:4]) != 0 {
		return nil, 0, ErrPreamble
	}
	dataLen := binary.BigEndian.Uint32(buf[4:8])
	// data field = codec id .. trailing record count (dataLen bytes), then 4B CRC.
	if uint32(len(buf)) < 8+dataLen+4 {
		return nil, 0, ErrShort
	}
	data := buf[8 : 8+dataLen]
	crcGot := binary.BigEndian.Uint32(buf[8+dataLen : 8+dataLen+4])
	if uint16(crcGot) != CRC16(data) {
		return nil, 0, ErrCRC
	}
	if data[0] != Codec8Extended {
		return nil, 0, ErrCodec
	}
	count = data[1]
	p := 2
	recs = make([]Record, 0, count)
	for i := 0; i < int(count); i++ {
		rec, n, perr := parseRecord(data[p:])
		if perr != nil {
			return nil, 0, fmt.Errorf("record %d: %w", i, perr)
		}
		recs = append(recs, rec)
		p += n
	}
	if p >= len(data) {
		return nil, 0, ErrShort
	}
	if data[p] != count {
		return nil, 0, ErrCount
	}
	return recs, count, nil
}

func parseRecord(b []byte) (Record, int, error) {
	// 8 ts + 1 prio + (4+4+2+2+1+2)=15 gps = 24 fixed bytes minimum
	if len(b) < 24 {
		return Record{}, 0, ErrShort
	}
	var r Record
	r.TimestampMs = binary.BigEndian.Uint64(b[0:8])
	r.Priority = b[8]
	r.GPS = GPS{
		LngE7:    int32(binary.BigEndian.Uint32(b[9:13])),
		LatE7:    int32(binary.BigEndian.Uint32(b[13:17])),
		Altitude: int16(binary.BigEndian.Uint16(b[17:19])),
		Angle:    binary.BigEndian.Uint16(b[19:21]),
		Sats:     b[21],
		Speed:    binary.BigEndian.Uint16(b[22:24]),
	}
	p := 24
	r.IO = map[uint16]int64{}

	// Codec 8E IO section: 2B event id, 2B total count, then N-byte groups each
	// prefixed by a 2B group count. Groups: 1B, 2B, 4B, 8B, then variable-length.
	if len(b) < p+4 {
		return Record{}, 0, ErrShort
	}
	r.EventIOID = binary.BigEndian.Uint16(b[p : p+2])
	p += 2
	// total count (b[p:p+2]) is informational; we trust the per-group counts.
	p += 2

	for _, width := range []int{1, 2, 4, 8} {
		if len(b) < p+2 {
			return Record{}, 0, ErrShort
		}
		n := int(binary.BigEndian.Uint16(b[p : p+2]))
		p += 2
		for j := 0; j < n; j++ {
			if len(b) < p+2+width {
				return Record{}, 0, ErrShort
			}
			id := binary.BigEndian.Uint16(b[p : p+2])
			p += 2
			var v int64
			switch width {
			case 1:
				v = int64(b[p])
			case 2:
				v = int64(binary.BigEndian.Uint16(b[p : p+2]))
			case 4:
				v = int64(binary.BigEndian.Uint32(b[p : p+4]))
			case 8:
				v = int64(binary.BigEndian.Uint64(b[p : p+8]))
			}
			r.IO[id] = v
			p += width
		}
	}

	// Variable-length (NX) IO group: 2B count, then per element 2B id, 2B len,
	// len bytes. We capture the length as the value (payload dropped) so unknown
	// variable elements do not break the parse.
	if len(b) < p+2 {
		return Record{}, 0, ErrShort
	}
	nx := int(binary.BigEndian.Uint16(b[p : p+2]))
	p += 2
	for j := 0; j < nx; j++ {
		if len(b) < p+4 {
			return Record{}, 0, ErrShort
		}
		id := binary.BigEndian.Uint16(b[p : p+2])
		p += 2
		vlen := int(binary.BigEndian.Uint16(b[p : p+2]))
		p += 2
		if len(b) < p+vlen {
			return Record{}, 0, ErrShort
		}
		r.IO[id] = int64(vlen)
		p += vlen
	}

	return r, p, nil
}

// BuildAVL encodes records into a complete Codec 8 Extended packet. It is used
// by the device simulator and by the parser round-trip tests. IO ids are emitted
// as 2-byte-width elements (the common case) grouped correctly by width; a
// deterministic key order keeps the output stable for tests.
func BuildAVL(recs []Record) []byte {
	var data []byte
	data = append(data, Codec8Extended, byte(len(recs)))
	for _, r := range recs {
		data = appendRecord(data, r)
	}
	data = append(data, byte(len(recs)))

	crc := CRC16(data)
	out := make([]byte, 0, 8+len(data)+4)
	out = append(out, 0, 0, 0, 0)
	out = binary.BigEndian.AppendUint32(out, uint32(len(data)))
	out = append(out, data...)
	out = binary.BigEndian.AppendUint32(out, uint32(crc))
	return out
}

func appendRecord(data []byte, r Record) []byte {
	data = binary.BigEndian.AppendUint64(data, r.TimestampMs)
	data = append(data, r.Priority)
	data = binary.BigEndian.AppendUint32(data, uint32(r.GPS.LngE7))
	data = binary.BigEndian.AppendUint32(data, uint32(r.GPS.LatE7))
	data = binary.BigEndian.AppendUint16(data, uint16(r.GPS.Altitude))
	data = binary.BigEndian.AppendUint16(data, r.GPS.Angle)
	data = append(data, r.GPS.Sats)
	data = binary.BigEndian.AppendUint16(data, r.GPS.Speed)

	// Split IO by minimal width needed. Keep deterministic ordering by sorting ids.
	g1, g2, g4, g8 := splitIOByWidth(r.IO)
	data = binary.BigEndian.AppendUint16(data, r.EventIOID)
	total := len(g1) + len(g2) + len(g4) + len(g8)
	data = binary.BigEndian.AppendUint16(data, uint16(total))

	data = binary.BigEndian.AppendUint16(data, uint16(len(g1)))
	for _, kv := range g1 {
		data = binary.BigEndian.AppendUint16(data, kv.id)
		data = append(data, byte(kv.val))
	}
	data = binary.BigEndian.AppendUint16(data, uint16(len(g2)))
	for _, kv := range g2 {
		data = binary.BigEndian.AppendUint16(data, kv.id)
		data = binary.BigEndian.AppendUint16(data, uint16(kv.val))
	}
	data = binary.BigEndian.AppendUint16(data, uint16(len(g4)))
	for _, kv := range g4 {
		data = binary.BigEndian.AppendUint16(data, kv.id)
		data = binary.BigEndian.AppendUint32(data, uint32(kv.val))
	}
	data = binary.BigEndian.AppendUint16(data, uint16(len(g8)))
	for _, kv := range g8 {
		data = binary.BigEndian.AppendUint16(data, kv.id)
		data = binary.BigEndian.AppendUint64(data, uint64(kv.val))
	}
	// no variable-length elements emitted by the encoder
	data = binary.BigEndian.AppendUint16(data, 0)
	return data
}
