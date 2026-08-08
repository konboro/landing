package protocol

import (
	"encoding/binary"
	"sort"
)

type iokv struct {
	id  uint16
	val int64
}

// splitIOByWidth places each IO value into the narrowest group that can hold it,
// mirroring how a real device encodes (booleans/small ints as 1B, voltages as
// 2B, etc.). Each group is sorted by id for deterministic output.
func splitIOByWidth(io map[uint16]int64) (g1, g2, g4, g8 []iokv) {
	for id, v := range io {
		kv := iokv{id: id, val: v}
		switch {
		case v >= 0 && v <= 0xFF:
			g1 = append(g1, kv)
		case v >= 0 && v <= 0xFFFF:
			g2 = append(g2, kv)
		case v >= 0 && v <= 0xFFFFFFFF:
			g4 = append(g4, kv)
		default:
			g8 = append(g8, kv)
		}
	}
	sort.Slice(g1, func(i, j int) bool { return g1[i].id < g1[j].id })
	sort.Slice(g2, func(i, j int) bool { return g2[i].id < g2[j].id })
	sort.Slice(g4, func(i, j int) bool { return g4[i].id < g4[j].id })
	sort.Slice(g8, func(i, j int) bool { return g8[i].id < g8[j].id })
	return g1, g2, g4, g8
}

// FrameLength returns the total length of the framed packet described by the
// leading [4B preamble][4B data length] header, or (0, false) if fewer than 8
// bytes are available. Works for both Codec 8E and Codec 12 (same framing).
func FrameLength(buf []byte) (int, bool) {
	if len(buf) < 8 {
		return 0, false
	}
	dataLen := binary.BigEndian.Uint32(buf[4:8])
	return 8 + int(dataLen) + 4, true
}

// BuildAck builds the Codec 8E telemetry acknowledgement: the record count as a
// 4-byte big-endian integer.
func BuildAck(count uint32) []byte {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, count)
	return b
}
