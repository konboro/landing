package protocol

import (
	"encoding/binary"
	"errors"
)

// Codec 12 command/response types.
const (
	Codec12TypeCommand  = 0x05
	Codec12TypeResponse = 0x06
)

// ErrNotCodec12 is returned when a buffer is not a Codec 12 frame.
var ErrNotCodec12 = errors.New("protocol: not a codec12 frame")

// BuildCommand encodes an ASCII command (e.g. "setdigout 1?") into a Codec 12
// GPRS command frame:
//
//	[4B zeroes][4B data size][0x0C][qty=1][0x05][4B cmd size][ASCII][qty=1][4B CRC16]
func BuildCommand(cmd string) []byte {
	return buildCodec12(Codec12TypeCommand, []byte(cmd))
}

// BuildResponse encodes a Codec 12 response frame (type 0x06). Used by the
// device simulator to reply to a command.
func BuildResponse(payload string) []byte {
	return buildCodec12(Codec12TypeResponse, []byte(payload))
}

func buildCodec12(typ byte, payload []byte) []byte {
	var data []byte
	data = append(data, Codec12)  // codec id
	data = append(data, 0x01)     // quantity 1
	data = append(data, typ)      // command/response type
	data = binary.BigEndian.AppendUint32(data, uint32(len(payload)))
	data = append(data, payload...)
	data = append(data, 0x01) // quantity 2

	crc := CRC16(data)
	out := make([]byte, 0, 8+len(data)+4)
	out = append(out, 0, 0, 0, 0)
	out = binary.BigEndian.AppendUint32(out, uint32(len(data)))
	out = append(out, data...)
	out = binary.BigEndian.AppendUint32(out, uint32(crc))
	return out
}

// ParseCodec12 parses a Codec 12 frame and returns its type byte and ASCII
// payload. It validates the preamble, codec id, quantities and CRC.
func ParseCodec12(buf []byte) (typ byte, payload string, err error) {
	if len(buf) < 8 {
		return 0, "", ErrShort
	}
	if binary.BigEndian.Uint32(buf[0:4]) != 0 {
		return 0, "", ErrPreamble
	}
	dataLen := binary.BigEndian.Uint32(buf[4:8])
	if uint32(len(buf)) < 8+dataLen+4 {
		return 0, "", ErrShort
	}
	data := buf[8 : 8+dataLen]
	crcGot := binary.BigEndian.Uint32(buf[8+dataLen : 8+dataLen+4])
	if uint16(crcGot) != CRC16(data) {
		return 0, "", ErrCRC
	}
	if len(data) < 8 || data[0] != Codec12 {
		return 0, "", ErrNotCodec12
	}
	// data: [0]=codec [1]=qty1 [2]=type [3:7]=size [7:7+size]=payload [.]=qty2
	typ = data[2]
	size := binary.BigEndian.Uint32(data[3:7])
	if uint32(len(data)) < 7+size+1 {
		return 0, "", ErrLength
	}
	payload = string(data[7 : 7+size])
	return typ, payload, nil
}
