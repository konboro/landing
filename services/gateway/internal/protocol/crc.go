// Package protocol implements the Teltonika wire codecs used by the FMB930:
// Codec 8 Extended (0x8E) for AVL telemetry and Codec 12 (0x0C) for commands.
package protocol

// CRC16/IBM (a.k.a. CRC-16/ARC): reflected polynomial 0xA001, init 0x0000,
// no final XOR, reflected in/out. Teltonika computes it over the "data field":
// from the codec id byte up to and including the trailing record-count byte.
//
// crc16Table is the precomputed lookup table for the byte-at-a-time variant.
var crc16Table [256]uint16

func init() {
	const poly = 0xA001
	for i := 0; i < 256; i++ {
		crc := uint16(i)
		for bit := 0; bit < 8; bit++ {
			if crc&1 != 0 {
				crc = (crc >> 1) ^ poly
			} else {
				crc >>= 1
			}
		}
		crc16Table[i] = crc
	}
}

// CRC16 returns the CRC-16/IBM over data. On the wire Teltonika stores this in
// the low 16 bits of a 4-byte big-endian field (the high 16 bits are always 0).
func CRC16(data []byte) uint16 {
	var crc uint16
	for _, b := range data {
		crc = (crc >> 8) ^ crc16Table[(crc^uint16(b))&0xFF]
	}
	return crc
}
